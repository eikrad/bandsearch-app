import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

import type { ChatMessage } from "../../../../shared/schemas/src/contracts.js";
import { parseModelJsonResponse, withTimeout } from "./recommendationAgent.js";

export const MUSICBRAINZ_PLANNED_QUERY_MAX_LENGTH = 200;
export const MUSICBRAINZ_PLANNER_HISTORY_MAX_CHARS = 3500;

let cachedArtistSearchReference: string | null = null;

function resolveMusicBrainzPromptPath(): string {
  const fileName = "musicbrainz-artist-search.md";
  const fromRepoRoot = join(process.cwd(), "services", "api", "src", "agent", "prompts", fileName);
  const fromApiPackage = join(process.cwd(), "src", "agent", "prompts", fileName);
  if (existsSync(fromRepoRoot)) return fromRepoRoot;
  if (existsSync(fromApiPackage)) return fromApiPackage;
  return fromRepoRoot;
}

/**
 * Loads `prompts/musicbrainz-artist-search.md` once. Used by the planner system prompt; exported for tests.
 */
export function getMusicBrainzArtistSearchReference(): string {
  if (cachedArtistSearchReference !== null) return cachedArtistSearchReference;
  try {
    cachedArtistSearchReference = readFileSync(resolveMusicBrainzPromptPath(), "utf8").trim();
  } catch {
    cachedArtistSearchReference =
      "MusicBrainz artist search only: GET /ws/2/artist?query=… Lucene syntax. Default fields: alias, artist, sortname. Doc: https://musicbrainz.org/doc/MusicBrainz_API/Search#Artist";
  }
  return cachedArtistSearchReference;
}

const PLANNER_ROLE = [
  "You help build a short MusicBrainz artist search string (Lucene query syntax on artist names and aliases).",
  "The user may describe moods, genres, or comparisons — distill them into search tokens that MusicBrainz can match (artist names, bands they mentioned, disambiguation keywords).",
  "Output a single JSON object only, no markdown fences: {\"musicBrainzQuery\":\"...\"}.",
  `musicBrainzQuery must be one line, ASCII or Unicode letters/numbers/spaces/punctuation only, no newlines, at most ${MUSICBRAINZ_PLANNED_QUERY_MAX_LENGTH} characters, non-empty after trim.`,
  "Prefer concrete artist or project names from the conversation when present; otherwise compact genre/scene keywords (not full sentences).",
].join(" ");

const RETRY_SYSTEM_ADDENDUM =
  "Your previous JSON was missing or invalid. Reply with ONLY one JSON object: {\"musicBrainzQuery\":\"...\"}. " +
  "The value must be a single-line non-empty string, at most 200 characters, suitable for MusicBrainz /ws/2/artist search.";

function buildPlannerSystemPrompt(): string {
  const reference = getMusicBrainzArtistSearchReference();
  return `${PLANNER_ROLE}\n\n---\n${reference}`;
}

export type MusicBrainzQueryPlannerInput = {
  userQuery: string;
  preferenceContext?: string;
  messages?: ChatMessage[];
};

function containsDisallowedMbQueryChars(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x20) return true;
  }
  return false;
}

/**
 * Normalize and validate a candidate MusicBrainz search string from the model.
 * Returns null if unusable.
 */
export function sanitizeMusicBrainzQueryCandidate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MUSICBRAINZ_PLANNED_QUERY_MAX_LENGTH) return null;
  if (containsDisallowedMbQueryChars(trimmed)) return null;
  return trimmed;
}

function extractMusicBrainzQueryFromParsed(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const q = (parsed as Record<string, unknown>).musicBrainzQuery;
  return sanitizeMusicBrainzQueryCandidate(q);
}

/** Test helper / diagnostics: parse model output text into a sanitized MB query or null. */
export function tryParseMusicBrainzQueryFromModelText(raw: string): string | null {
  try {
    return extractMusicBrainzQueryFromParsed(parseModelJsonResponse(raw));
  } catch {
    return null;
  }
}

function formatHistoryForPlanner(messages: ChatMessage[] | undefined): string {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  const lines: string[] = [];
  let total = 0;
  let omitted = false;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== "user" && m.role !== "assistant") continue;
    const role = m.role === "user" ? "user" : "assistant";
    const content = String(m.content || "").trim();
    if (!content) continue;
    const line = `${role}: ${content}`;
    if (total + line.length + 1 > MUSICBRAINZ_PLANNER_HISTORY_MAX_CHARS) {
      omitted = true;
      break;
    }
    lines.push(line);
    total += line.length + 1;
  }
  if (omitted) lines.push("… (earlier messages omitted)");
  return lines.reverse().join("\n");
}

function buildPlannerUserContent(input: MusicBrainzQueryPlannerInput): string {
  const pref = typeof input.preferenceContext === "string" ? input.preferenceContext.trim() : "";
  const history = formatHistoryForPlanner(input.messages);
  const parts = [`current_user_query: ${String(input.userQuery || "").trim()}`];
  if (pref) parts.push(`preference_context: ${pref}`);
  if (history) parts.push(`conversation_excerpt:\n${history}`);
  return parts.join("\n\n");
}

export type CreateMusicBrainzQueryPlannerOptions = {
  apiKey: string;
  timeoutMs?: number;
  model?: string;
};

/**
 * Gemini step: propose a MusicBrainz-friendly search string. On invalid output, one correction
 * retry, then falls back to trimmed userQuery.
 */
export async function createMusicBrainzQueryPlanner({
  apiKey,
  timeoutMs = 4000,
  model = "gemini-2.5-flash",
}: CreateMusicBrainzQueryPlannerOptions): Promise<(input: MusicBrainzQueryPlannerInput) => Promise<string>> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    throw new Error("apiKey is required for MusicBrainz query planner");
  }

  const plannerModel = new ChatGoogleGenerativeAI({
    model,
    apiKey: trimmedKey,
    temperature: 0.15,
  });

  const plannerSystemPrompt = buildPlannerSystemPrompt();

  async function invokeOnce(systemText: string, userContent: string): Promise<string | null> {
    const prompt = [
      { role: "system" as const, content: systemText },
      { role: "user" as const, content: userContent },
    ];
    const response = await withTimeout(plannerModel.invoke(prompt), timeoutMs, "musicbrainz planner timeout");
    const raw = typeof response.content === "string" ? response.content : "";
    try {
      const parsed = parseModelJsonResponse(raw);
      return extractMusicBrainzQueryFromParsed(parsed);
    } catch {
      return null;
    }
  }

  return async function planMusicBrainzSearch(input: MusicBrainzQueryPlannerInput): Promise<string> {
    const fallback = String(input.userQuery || "").trim();
    if (!fallback) return "";

    const userContent = buildPlannerUserContent(input);
    const first = await invokeOnce(plannerSystemPrompt, userContent);
    if (first) return first;

    const second = await invokeOnce(`${plannerSystemPrompt} ${RETRY_SYSTEM_ADDENDUM}`, userContent);
    if (second) return second;

    return fallback;
  };
}

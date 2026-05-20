import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

import type { ChatMessage } from "../../../../shared/schemas/src/contracts.js";
import { EMBEDDED_MUSICBRAINZ_ARTIST_SEARCH_REFERENCE } from "./prompts/musicBrainzArtistSearchReference.embedded.js";
import { formatHistoryBlock, wrapPreferenceContext, wrapUserContent } from "./promptGuards.js";
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
 * Prefer `musicbrainz-artist-search.md` on disk when present (local edits); otherwise use the
 * embedded copy so deploys never depend on shipping loose markdown.
 */
export function getMusicBrainzArtistSearchReference(): string {
  if (cachedArtistSearchReference !== null) return cachedArtistSearchReference;
  const path = resolveMusicBrainzPromptPath();
  if (existsSync(path)) {
    try {
      cachedArtistSearchReference = readFileSync(path, "utf8").trim();
      return cachedArtistSearchReference;
    } catch {
      /* use embedded */
    }
  }
  cachedArtistSearchReference = EMBEDDED_MUSICBRAINZ_ARTIST_SEARCH_REFERENCE;
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

function buildPlannerUserContent(input: MusicBrainzQueryPlannerInput): string {
  const wrappedQuery = wrapUserContent(String(input.userQuery || "").trim());
  const prefBlock = wrapPreferenceContext(typeof input.preferenceContext === "string" ? input.preferenceContext : "");
  const history = formatHistoryBlock(input.messages ?? [], MUSICBRAINZ_PLANNER_HISTORY_MAX_CHARS);
  const parts = [`current_user_query: ${wrappedQuery}`];
  if (prefBlock) parts.push(prefBlock);
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

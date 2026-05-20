import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

import type { ChatMessage } from "../../../../../shared/schemas/src/contracts.js";
import { formatHistoryBlock, wrapPreferenceContext, wrapUserContent } from "../promptGuards.js";
import { parseModelJsonResponse, withTimeout } from "../recommendationAgent.js";

export const WEB_SEARCH_PLAN_HISTORY_MAX_CHARS = 3500;
export const WEB_SEARCH_QUERY_MAX_LENGTH = 400;
export const WEB_SEARCH_PLAN_MAX_QUERIES = 20;

export type SearchPlan = {
  anchorArtists: string[];
  styleSignals: string[];
  mustHave: string[];
  avoid: string[];
  queries: string[];
};

const PLANNER_ROLE = [
  "You plan Brave web searches to discover niche bands matching the user's taste.",
  "Anchors are reference bands the user named — searches should find OTHER bands (FFO / RIYL / newer acts), not only repeat anchor names.",
  "Each query must be a concise web search string (keywords, \"FFO …\", site:bandcamp.com when helpful). No natural-language paragraphs.",
  `Output ONLY one JSON object, no markdown fences: {"anchorArtists":[],"styleSignals":[],"mustHave":[],"avoid":[],"queries":[]}.`,
  `queries must be at most ${WEB_SEARCH_PLAN_MAX_QUERIES} items; each query at most ${WEB_SEARCH_QUERY_MAX_LENGTH} characters, single line, non-empty after trim.`,
].join(" ");

const RETRY_SYSTEM_ADDENDUM =
  "Your previous JSON was invalid. Reply with ONLY one JSON object: " +
  '{"anchorArtists":[],"styleSignals":[],"mustHave":[],"avoid":[],"queries":[]}. ' +
  "queries must be a non-empty array of strings.";

function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (t) out.push(t);
  }
  return out;
}

function sanitizeQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of queries) {
    const trimmed = q.trim().replace(/\s+/g, " ");
    if (!trimmed || trimmed.length > WEB_SEARCH_QUERY_MAX_LENGTH) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= WEB_SEARCH_PLAN_MAX_QUERIES) break;
  }
  return out;
}

function extractPlanFromParsed(parsed: unknown): SearchPlan | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const queries = sanitizeQueries(normalizeStringArray(o.queries));
  if (queries.length === 0) return null;
  return {
    anchorArtists: normalizeStringArray(o.anchorArtists),
    styleSignals: normalizeStringArray(o.styleSignals),
    mustHave: normalizeStringArray(o.mustHave),
    avoid: normalizeStringArray(o.avoid),
    queries,
  };
}

/** Test helper / diagnostics */
export function tryParseSearchPlanFromModelText(raw: string): SearchPlan | null {
  try {
    const parsed = parseModelJsonResponse(raw);
    return extractPlanFromParsed(parsed);
  } catch {
    return null;
  }
}

export type WebSearchPlannerInput = {
  userQuery: string;
  preferenceContext?: string;
  messages?: ChatMessage[];
};

function buildPlannerUserContent(input: WebSearchPlannerInput): string {
  const wrappedQuery = wrapUserContent(String(input.userQuery || "").trim());
  const prefBlock = wrapPreferenceContext(typeof input.preferenceContext === "string" ? input.preferenceContext : "");
  const history = formatHistoryBlock(input.messages ?? [], WEB_SEARCH_PLAN_HISTORY_MAX_CHARS);
  const parts = [`current_user_query: ${wrappedQuery}`];
  if (prefBlock) parts.push(prefBlock);
  if (history) parts.push(`conversation_excerpt:\n${history}`);
  return parts.join("\n\n");
}

/** Fallback when the model fails: single broad query from user text */
export function fallbackSearchPlan(userQuery: string): SearchPlan {
  const q = String(userQuery || "").trim();
  const base = q.slice(0, Math.min(q.length, WEB_SEARCH_QUERY_MAX_LENGTH - 40));
  const queries = sanitizeQueries([`${base} newer band bandcamp FFO`].filter(Boolean));
  return {
    anchorArtists: [],
    styleSignals: [],
    mustHave: [],
    avoid: [],
    queries: queries.length ? queries : ["niche band bandcamp FFO similar artists"],
  };
}

export type CreateWebSearchPlannerOptions = {
  apiKey: string;
  timeoutMs?: number;
  model?: string;
};

export async function createWebSearchPlanner({
  apiKey,
  timeoutMs = 8000,
  model = "gemini-2.5-flash",
}: CreateWebSearchPlannerOptions): Promise<(input: WebSearchPlannerInput) => Promise<SearchPlan>> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    throw new Error("apiKey is required for web search planner");
  }

  const plannerModel = new ChatGoogleGenerativeAI({
    model,
    apiKey: trimmedKey,
    temperature: 0.2,
  });

  const plannerSystemPrompt = PLANNER_ROLE;

  async function invokeOnce(systemText: string, userContent: string): Promise<SearchPlan | null> {
    const prompt = [
      { role: "system" as const, content: systemText },
      { role: "user" as const, content: userContent },
    ];
    const response = await withTimeout(plannerModel.invoke(prompt), timeoutMs, "web search planner timeout");
    const raw = typeof response.content === "string" ? response.content : "";
    try {
      const parsed = parseModelJsonResponse(raw);
      return extractPlanFromParsed(parsed);
    } catch {
      return null;
    }
  }

  return async function planWebSearches(input: WebSearchPlannerInput): Promise<SearchPlan> {
    const fallback = fallbackSearchPlan(input.userQuery);
    const userContent = buildPlannerUserContent(input);
    if (!String(input.userQuery || "").trim()) {
      return fallback;
    }

    const first = await invokeOnce(plannerSystemPrompt, userContent);
    if (first) return first;

    const second = await invokeOnce(`${plannerSystemPrompt} ${RETRY_SYSTEM_ADDENDUM}`, userContent);
    if (second) return second;

    return fallback;
  };
}

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

import type { ChatMessage } from "../../../../../shared/schemas/src/contracts.js";
import { DISCOVERY_DOMAINS } from "../../eval/searchSourceScorer.js";
import { formatHistoryBlock, wrapPreferenceContext, wrapUserContent } from "../promptGuards.js";
import type { ChatModelClient } from "../modelUtils.js";
import { parseModelJsonResponse, withTimeout } from "../modelUtils.js";

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

const DOMAIN_DESCRIPTIONS: Record<string, string> = {
  "bandcamp.com": "site:bandcamp.com — niche releases, genre tags, FFO artist pages (almost always useful);",
  "rateyourmusic.com": "site:rateyourmusic.com — genre lists, similar-artist charts, 'sounds like' pages;",
  "rym.xyz": "site:rym.xyz — RYM mirror, same genre lists and charts;",
  "reddit.com": "site:reddit.com/r/ifyoulikeblank or site:reddit.com/r/<genre> — community RIYL threads;",
  "last.fm": "site:last.fm — similar-artist pages (last.fm/music/<artist>/+similar);",
  "lastfm.com": "site:lastfm.com — similar-artist pages;",
  "metal-archives.com": "site:metal-archives.com — metal and extreme music only, skip for electronic/jazz/folk;",
  "sputnikmusic.com": "site:sputnikmusic.com — rock and metal reviews with FFO sections;",
};

const DISCOVERY_SOURCES = [
  "Prioritise these sources in queries where relevant:",
  ...DISCOVERY_DOMAINS.map((d) => DOMAIN_DESCRIPTIONS[d] ?? `site:${d};`),
  "niche blogs: thequietus.com, heavyblogisheavy.com, cvltnation.com, exclaim.ca — for scene discoveries.",
  "Match sources to genre — do not use metal-archives.com for ambient or jazz queries.",
].join(" ");

const PLANNER_ROLE = [
  "You plan Brave web searches to discover niche bands matching the user's taste.",
  "Anchors are reference bands the user named — searches should find OTHER bands (FFO / RIYL / newer acts), not only repeat anchor names.",
  "When conversation_excerpt is present, treat current_user_query as a follow-up refinement of the ongoing session — adjust your anchors and style signals to the new direction, and add any bands already recommended in the conversation to the 'avoid' array so they are not suggested again.",
  DISCOVERY_SOURCES,
  "Each query must be a concise web search string (keywords, site: operators, \"FFO …\"). No natural-language paragraphs.",
  `Output ONLY one JSON object, no markdown fences: {"anchorArtists":[],"styleSignals":[],"mustHave":[],"avoid":[],"queries":[]}.`,
  `queries must be at most ${WEB_SEARCH_PLAN_MAX_QUERIES} items; each query at most ${WEB_SEARCH_QUERY_MAX_LENGTH} characters, single line, non-empty after trim.`,
].join(" ");

/** Exported for testing only */
export const PLANNER_SYSTEM_PROMPT_FOR_TEST = PLANNER_ROLE;

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
  obscurityTarget?: string;
};

const OBSCURITY_CONSTRAINT: Record<string, string> = {
  cult: "Prioritise bands with 50k–500k Last.fm listeners — niche enough to feel like a discovery, not totally unknown.",
  underground: "Prioritise bands with under 50k Last.fm listeners — genuinely underground, avoid any mainstream crossover acts.",
  obscure: "Prioritise bands with under 5k Last.fm listeners — truly obscure, deep-cut discoveries only.",
};

function buildPlannerUserContent(input: WebSearchPlannerInput): string {
  const wrappedQuery = wrapUserContent(String(input.userQuery || "").trim());
  const prefBlock = wrapPreferenceContext(typeof input.preferenceContext === "string" ? input.preferenceContext : "");
  const history = formatHistoryBlock(input.messages ?? [], WEB_SEARCH_PLAN_HISTORY_MAX_CHARS);
  const parts = [`current_user_query: ${wrappedQuery}`];
  if (prefBlock) parts.push(prefBlock);
  if (history) parts.push(`conversation_excerpt:\n${history}`);
  const constraint = input.obscurityTarget ? OBSCURITY_CONSTRAINT[input.obscurityTarget] : undefined;
  if (constraint) parts.push(`obscurity_target (${input.obscurityTarget}): ${constraint}`);
  return parts.join("\n\n");
}

/** Exported for testing only — do not use in production code */
export const buildPlannerUserContentForTest = buildPlannerUserContent;

/** Fallback when the model fails: single broad query from user text */
export function fallbackSearchPlan(userQuery: string): SearchPlan {
  const q = String(userQuery || "").trim();
  const base = q.slice(0, Math.min(q.length, WEB_SEARCH_QUERY_MAX_LENGTH - 60));
  const queries = sanitizeQueries([
    `${base} site:bandcamp.com FFO`,
    `${base} site:rateyourmusic.com similar artists`,
    `${base} site:reddit.com/r/ifyoulikeblank`,
  ].filter(Boolean));
  return {
    anchorArtists: [],
    styleSignals: [],
    mustHave: [],
    avoid: [],
    queries: queries.length ? queries : ["niche band site:bandcamp.com FFO similar artists"],
  };
}

export type CreateWebSearchPlannerOptions = {
  apiKey: string;
  timeoutMs?: number;
  model?: string;
  /**
   * Chat model to use. Defaults to Gemini built from `apiKey`; supply one to
   * drive this factory's closure without a key or a network call.
   */
  modelClient?: ChatModelClient;
};

export async function createWebSearchPlanner({
  apiKey,
  timeoutMs = 20000,
  model = "gemini-2.5-flash",
  modelClient: injectedModelClient,
}: CreateWebSearchPlannerOptions): Promise<(input: WebSearchPlannerInput) => Promise<SearchPlan>> {
  // An injected client stands in for Gemini entirely, so it needs no key.
  const trimmedKey = apiKey.trim();
  if (!injectedModelClient && !trimmedKey) {
    throw new Error("apiKey is required for web search planner");
  }

  const plannerModel: ChatModelClient = injectedModelClient ?? new ChatGoogleGenerativeAI({
    model,
    apiKey: trimmedKey,
    temperature: 0.2,
    thinkingConfig: { thinkingBudget: 0 },
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

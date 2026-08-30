import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

import { capAndTrim, wrapUserContent } from "../promptGuards.js";
import type { ChatModelClient } from "../modelUtils.js";
import { parseModelJsonResponse, withTimeout } from "../modelUtils.js";

import type { SearchPlan } from "./webSearchPlanner.js";
import type { VerifiedCandidate } from "./candidateVerifier.js";

export const REFLECTION_QUERY_MAX_LENGTH = 400;

export type ReflectionResult = {
  sufficient: boolean;
  gaps: string[];
  extraQueries: string[];
};

const SYSTEM = [
  "You evaluate whether web search found enough niche band candidates for a music recommendation request.",
  "If there are too few verified candidates, propose additional Brave web search queries.",
  "Prefer targeted sources: site:bandcamp.com (genre tags, FFO pages), site:rateyourmusic.com (similar-artist lists),",
  "site:reddit.com/r/ifyoulikeblank, site:last.fm (similar pages), site:metal-archives.com (metal only),",
  "site:sputnikmusic.com, niche blogs (thequietus.com, heavyblogisheavy.com, cvltnation.com).",
  "Match sources to the inferred genre — do not suggest metal-archives.com for non-metal queries.",
  `Output ONLY JSON: {"sufficient":true|false,"gaps":["short reason"],"extraQueries":["query strings"]}.`,
  `Each extra query must be one line, at most ${REFLECTION_QUERY_MAX_LENGTH} characters.`,
].join(" ");

const RETRY_ADDENDUM =
  "Invalid JSON. Reply with ONLY: {\"sufficient\":false,\"gaps\":[],\"extraQueries\":[\"\"]}. extraQueries must be a JSON array of strings.";

function sanitizeExtraQueries(raw: unknown, maxQueries: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const t = item.trim().replace(/\s+/g, " ");
    if (!t || t.length > REFLECTION_QUERY_MAX_LENGTH) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= maxQueries) break;
  }
  return out;
}

function extractReflection(parsed: unknown, maxExtraQueries: number): ReflectionResult | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.sufficient !== "boolean") return null;
  const gaps = Array.isArray(o.gaps)
    ? o.gaps.filter((g): g is string => typeof g === "string" && Boolean(g.trim())).map((g) => g.trim())
    : [];
  const extraQueries = sanitizeExtraQueries(o.extraQueries, maxExtraQueries);
  return {
    sufficient: o.sufficient,
    gaps,
    extraQueries,
  };
}

/** Test helper */
export function tryParseReflectionFromModelText(raw: string, maxExtraQueries: number): ReflectionResult | null {
  try {
    const parsed = parseModelJsonResponse(raw);
    return extractReflection(parsed, maxExtraQueries);
  } catch {
    return null;
  }
}

export type CreateRecommendationReflectorOptions = {
  apiKey: string;
  timeoutMs?: number;
  maxExtraQueries?: number;
  model?: string;
  /**
   * Chat model to use. Defaults to Gemini built from `apiKey`; supply one to
   * drive this factory's closure without a key or a network call.
   */
  modelClient?: ChatModelClient;
};

export async function createRecommendationReflector({
  apiKey,
  timeoutMs = 6000,
  maxExtraQueries = 4,
  model = "gemini-2.5-flash",
  modelClient: injectedModelClient,
}: CreateRecommendationReflectorOptions): Promise<
  (input: {
    userQuery: string;
    plan: SearchPlan;
    verifiedCandidates: VerifiedCandidate[];
    targetVerifiedCount: number;
    searchBudgetRemaining: number;
  }) => Promise<ReflectionResult>
> {
  // An injected client stands in for Gemini entirely, so it needs no key.
  const trimmedKey = apiKey.trim();
  if (!injectedModelClient && !trimmedKey) {
    throw new Error("apiKey is required for recommendation reflector");
  }

  const modelClient: ChatModelClient = injectedModelClient ?? new ChatGoogleGenerativeAI({
    model,
    apiKey: trimmedKey,
    temperature: 0.15,
    thinkingConfig: { thinkingBudget: 0 },
  });

  async function invokeOnce(systemText: string, userContent: string): Promise<ReflectionResult | null> {
    const prompt = [
      { role: "system" as const, content: systemText },
      { role: "user" as const, content: userContent },
    ];
    const response = await withTimeout(modelClient.invoke(prompt), timeoutMs, "reflector timeout");
    const raw = typeof response.content === "string" ? response.content : "";
    try {
      const parsed = parseModelJsonResponse(raw);
      return extractReflection(parsed, maxExtraQueries);
    } catch {
      return null;
    }
  }

  return async function reflect(input): Promise<ReflectionResult> {
    const verifiedCount = input.verifiedCandidates.filter((c) => c.verified).length;
    const defaultSufficient = verifiedCount >= input.targetVerifiedCount || input.searchBudgetRemaining <= 0;

    const userContent = [
      `current_user_query: ${wrapUserContent(capAndTrim(String(input.userQuery || ""), 2000))}`,
      `anchors: ${input.plan.anchorArtists.join(", ")}`,
      `style_signals: ${input.plan.styleSignals.join(", ")}`,
      `verified_candidate_count: ${verifiedCount}`,
      `target_verified_count: ${input.targetVerifiedCount}`,
      `search_budget_remaining_brave_calls: ${input.searchBudgetRemaining}`,
      `sample_candidates: ${JSON.stringify(
        input.verifiedCandidates.slice(0, 12).map((c) => ({
          name: c.canonicalName ?? c.name,
          verified: c.verified,
          mbid: c.mbid,
        })),
      )}`,
    ].join("\n");

    const first = await invokeOnce(SYSTEM, userContent);
    if (first) {
      return {
        sufficient: first.sufficient,
        gaps: first.gaps,
        extraQueries: first.extraQueries.slice(0, maxExtraQueries),
      };
    }

    const second = await invokeOnce(`${SYSTEM} ${RETRY_ADDENDUM}`, userContent);
    if (second) {
      return {
        sufficient: second.sufficient,
        gaps: second.gaps,
        extraQueries: second.extraQueries.slice(0, maxExtraQueries),
      };
    }

    return {
      sufficient: defaultSufficient,
      gaps: [],
      extraQueries: [],
    };
  };
}

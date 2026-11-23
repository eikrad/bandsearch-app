
import type { ChatMessage, ObscurityTarget, RecommendationMode } from "../../../../../shared/schemas/src/contracts.js";
import { validateObscurityTarget, validateRecommendationItem } from "../../../../../shared/schemas/src/contracts.js";
import { OBSCURITY_TARGET_RANGES, fitObscurityTarget } from "../../obscurityTargets.js";
import { REPLY_LANGUAGE_FIELD, REPLY_LANGUAGE_RULE } from "../../replyLanguage.js";
import { recentTurns, wrapPreferenceContext, wrapUserContent } from "../promptGuards.js";
import type { ChatModelClient } from "../modelUtils.js";
import { invokeModel, parseModelJsonResponse, replySoFar } from "../modelUtils.js";

import { foundOnTheWeb } from "./lastFmEnrichment.js";
import { mergeVerifiedCandidates, type VerifiedCandidate } from "./candidateVerifier.js";
import { nodeModel, type ChatModelFactory } from "../../llm/chatModel.js";

function pickReplyFromParsed(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object") return "";
  const p = parsed as Record<string, unknown>;
  const candidates = [p.reply, p.assistant_reply, p.message, p.summary, p.narrative];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

function validateRecommendationOutput(output: unknown[]): unknown[] {
  if (!Array.isArray(output) || output.some((item) => !validateRecommendationItem(item).ok)) {
    throw new Error("invalid recommendation output");
  }
  return output;
}

function normalizeRankPayload(parsed: unknown): { assistantReply: string; recommendations: unknown[] } {
  if (Array.isArray(parsed)) {
    return { assistantReply: "", recommendations: validateRecommendationOutput(parsed) };
  }
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).recommendations)) {
    const assistantReply = pickReplyFromParsed(parsed);
    return {
      assistantReply,
      recommendations: validateRecommendationOutput(
        (parsed as Record<string, unknown>).recommendations as unknown[],
      ),
    };
  }
  throw new Error("invalid recommendation output");
}

/**
 * True if `why` cites at least one evidence URL (substring or same host).
 */
export function whyContainsEvidenceCitation(why: string, evidenceUrls: string[]): boolean {
  const w = why.toLowerCase();
  for (const u of evidenceUrls) {
    if (!u) continue;
    if (w.includes(String(u).toLowerCase())) return true;
    try {
      const host = new URL(u).host;
      if (w.includes(host.toLowerCase())) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function findCandidateForArtist(
  artistName: string,
  candidates: VerifiedCandidate[],
): VerifiedCandidate | undefined {
  const key = String(artistName || "").trim().toLowerCase();
  return candidates.find(
    (c) =>
      c.name.trim().toLowerCase() === key
      || (c.canonicalName && c.canonicalName.trim().toLowerCase() === key),
  );
}

/**
 * Ensure each recommendation's `why` cites an evidence URL; append one if the model omitted it.
 * Drops items that still cannot be attributed (should be rare).
 */
export function attachEvidenceCitationsToRecommendations(
  recommendations: unknown[],
  candidates: VerifiedCandidate[],
): unknown[] {
  const out: unknown[] = [];
  for (const item of recommendations) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const artist = String(row.artist ?? "").trim();
    const why = String(row.why ?? "").trim();
    if (!artist || !why) continue;

    const cand = findCandidateForArtist(artist, candidates);
    // A candidate found in a snippet without a URL is still attributable to its MusicBrainz record.
    const recordUrl = cand?.mbid ? `https://musicbrainz.org/artist/${cand.mbid}` : undefined;
    const evidenceUrls = cand?.evidenceUrls.length ? cand.evidenceUrls : recordUrl ? [recordUrl] : [];

    let nextWhy = why;
    if (!whyContainsEvidenceCitation(nextWhy, evidenceUrls)) {
      const fallback = evidenceUrls[0];
      if (!fallback) continue;
      nextWhy = `${why} (see ${fallback})`;
    }

    const modelSignals = Array.isArray(row.sourceSignals) ? [...(row.sourceSignals as string[])] : [];
    // Where a band was found is known here; what the model claims about it is not evidence.
    const found = cand && !foundOnTheWeb(cand) ? "lastfm_similarity" : "web_search";
    const signals = [...modelSignals.filter((s) => s !== "web_search" && s !== "lastfm_similarity"), found];
    if (cand?.verified && !signals.includes("musicbrainz_verification")) {
      signals.push("musicbrainz_verification");
    }

    out.push({
      ...row,
      why: nextWhy,
      sourceSignals: signals,
      ...(cand?.mbid ? { musicbrainzArtistId: cand.mbid } : {}),
    });
  }
  return out;
}

export function formatEvidenceForPrompt(candidates: VerifiedCandidate[], obscurityTarget?: string): string {
  const deduped = mergeVerifiedCandidates(candidates);
  // The filter's own rule, so the ranker sees each candidate as the filter and eval do (#325).
  const fits = fitObscurityTarget(deduped.map((c) => c.listenerCount), obscurityTarget);
  const lines: string[] = [];
  for (const [i, c] of deduped.entries()) {
    const name = c.canonicalName || c.name;
    const bits = [
      `artist: ${name}`,
      `verified_in_musicbrainz: ${c.verified}`,
      `evidence_urls: ${c.evidenceUrls.join(" | ")}`,
      `snippets: ${c.evidenceSnippets.join(" / ")}`,
    ];
    if (c.mbTags?.length) bits.push(`mb_tags: ${c.mbTags.join(", ")}`);
    if (c.listenerTags?.length) bits.push(`lastfm_tags: ${c.listenerTags.join(", ")}`);
    if (c.country) bits.push(`country: ${c.country}`);
    if (c.lifeSpan?.begin) bits.push(`active_from: ${c.lifeSpan.begin}, ended: ${c.lifeSpan.ended}`);
    if (c.listenerCount != null) bits.push(`lastfm_listeners: ${c.listenerCount.toLocaleString("en-US")}`);
    if (fits) bits.push(`target_range_fit: ${fits[i]!.fit}`);
    lines.push(bits.join("\n"));
  }
  return lines.join("\n---\n");
}

const RANK_SYSTEM = [
  'You recommend niche bands using ONLY the evidence block below. Respond with a single JSON object only — never a bare JSON array.',
  `Shape: {"language":"<${REPLY_LANGUAGE_FIELD}>","reply":"<string>","recommendations":[{"artist":"<string>","why":"<string>","sourceSignals":["<string>",...]}]}.`,
  "The reply must be 2–4 sentences: acknowledge the user's taste, tie picks to their query, ask one follow-up.",
  "Recommendations: at most 3 items. Each why MUST quote or include at least one full URL from evidence_urls for that artist (Bandcamp, blog, etc.).",
  "sourceSignals must include agent_reasoning, musicbrainz_verification when the candidate was verified, and user_preferences when relevant.",
  "Only recommend artists present in the evidence list; use the exact spelling from evidence.",
  REPLY_LANGUAGE_RULE,
].join(" ");

const RANK_HISTORY_MAX_CHARS = 7000;

const fmt = (n: number) => n.toLocaleString("en-US");

const RANK_OBSCURITY_FLAVOUR: Record<ObscurityTarget, string> = {
  cult: "Acts known within their scene but not household names.",
  underground: "Genuinely underground acts with a real but small audience.",
  obscure: "Deep cuts: Bandcamp, DIY and niche-blog acts.",
};

/** The ranker's obscurity instruction, from the same ranges the filter and eval use (#325). */
function rankObscurity(target: ObscurityTarget): string {
  const { min, max } = OBSCURITY_TARGET_RANGES[target];
  return [
    `Pick artists with ${fmt(min)}–${fmt(max)} Last.fm listeners. ${RANK_OBSCURITY_FLAVOUR[target]}`,
    "A pick below the range is as wrong as one above it.",
    "Prefer candidates whose target_range_fit is inRange; pick one outside the range only when too few inRange candidates fit the query, and then the nearest.",
  ].join(" ");
}

export type CreateRecommendationRankerOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** A ready chat model; tests pass one to run the closure without a network call. */
  modelClient?: ChatModelClient;
  /** Builds this node's model from the configured provider (llm/chatModel.ts). */
  chatModel?: ChatModelFactory;
};

export type RankInput = {
  query: string;
  preferenceContext: string;
  messages: ChatMessage[];
  mode: RecommendationMode;
  candidates: VerifiedCandidate[];
  obscurityTarget?: string;
  /** Told the reply so far while it is written. */
  onReply?: (text: string) => void;
};

/** Passes on a reply as it grows out of the ranker's JSON, without repeating itself. */
function replyListener(onReply: ((text: string) => void) | undefined): ((raw: string) => void) | undefined {
  if (!onReply) return undefined;
  let last = "";
  return (raw) => {
    const reply = replySoFar(raw);
    if (reply && reply !== last) onReply(last = reply);
  };
}

export function buildRankUserPartsForTest(input: {
  query: string;
  preferenceContext?: string;
  mode: RecommendationMode;
  candidates?: VerifiedCandidate[];
  obscurityTarget?: string;
}): string[] {
  const wrappedQuery = wrapUserContent(input.query);
  const prefBlock = wrapPreferenceContext(input.preferenceContext ?? "");
  const parts = [`query: ${wrappedQuery}`, `mode: ${input.mode}`];
  if (prefBlock) parts.push(prefBlock);
  const target = validateObscurityTarget(input.obscurityTarget);
  if (target) parts.push(`obscurity_rank (${target}): ${rankObscurity(target)}`);
  if (input.candidates) {
    const evidence = formatEvidenceForPrompt(input.candidates, input.obscurityTarget);
    parts.push(`evidence_candidates:\n${evidence}`, "limit: 3");
  }
  return parts;
}

export async function createRecommendationRanker({
  timeoutMs = 12000,
  signal,
  modelClient: injectedModelClient,
  chatModel,
}: CreateRecommendationRankerOptions): Promise<
  (input: RankInput) => Promise<{ recommendations: unknown[]; assistantReply: string }>
> {
  const modelClient = nodeModel("recommendation ranker", { modelClient: injectedModelClient, chatModel }, { temperature: 0.35 });

  return async function rank(input) {
    const prompt: Array<{ role: string; content: string }> = [
      { role: "system", content: RANK_SYSTEM },
      ...recentTurns(input.messages, RANK_HISTORY_MAX_CHARS),
    ];

    const parts = buildRankUserPartsForTest({
      query: input.query,
      preferenceContext: input.preferenceContext,
      mode: input.mode,
      candidates: input.candidates,
      obscurityTarget: input.obscurityTarget,
    });
    prompt.push({ role: "user", content: parts.join("\n") });

    const response = await invokeModel(modelClient, prompt, { signal, timeoutMs, timeoutMessage: "recommendation ranker timeout", onText: replyListener(input.onReply) });
    const raw = typeof response.content === "string" ? response.content : "";
    const parsed = parseModelJsonResponse(raw);
    let normalized = normalizeRankPayload(parsed);
    let recommendations = attachEvidenceCitationsToRecommendations(
      normalized.recommendations,
      input.candidates,
    );

    if (recommendations.length === 0 && normalized.recommendations.length > 0) {
      const retryPrompt = [
        ...prompt.slice(0, -1),
        {
          role: "user" as const,
          content: `${(prompt[prompt.length - 1] as { content: string }).content}\n\nYour previous answer omitted required evidence URLs in why fields. Repeat with each why containing a full https URL from evidence_urls.`,
        },
      ];
      const response2 = await invokeModel(modelClient, retryPrompt, { signal, timeoutMs, timeoutMessage: "recommendation ranker retry", onText: replyListener(input.onReply) });
      const raw2 = typeof response2.content === "string" ? response2.content : "";
      const parsed2 = parseModelJsonResponse(raw2);
      normalized = normalizeRankPayload(parsed2);
      recommendations = attachEvidenceCitationsToRecommendations(
        normalized.recommendations,
        input.candidates,
      );
    }

    let assistantReply = normalized.assistantReply;
    if (!assistantReply && recommendations.length > 0) {
      const names = recommendations
        .map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>).artist : null))
        .filter((n): n is string => typeof n === "string" && Boolean(n.trim()));
      assistantReply = `Here are picks grounded in search evidence: ${names.slice(0, 3).join(", ")}. Want to narrow by era, region, or heavier/softer sound?`;
    }

    return { recommendations, assistantReply };
  };
}

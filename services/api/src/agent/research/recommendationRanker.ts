import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

import type { ChatMessage, RecommendationMode } from "../../../../../shared/schemas/src/contracts.js";
import { validateRecommendationItem } from "../../../../../shared/schemas/src/contracts.js";
import { capAndTrim, escapeEnvelopeChars, wrapPreferenceContext, wrapUserContent } from "../promptGuards.js";
import { parseModelJsonResponse, withTimeout } from "../modelUtils.js";

import type { VerifiedCandidate } from "./candidateVerifier.js";

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
 * True if `why` cites at least one evidence or MB URL (substring or same host).
 */
export function whyContainsEvidenceCitation(why: string, evidenceUrls: string[], mbUrls: string[] = []): boolean {
  const all = [...evidenceUrls, ...mbUrls].filter(Boolean);
  const w = why.toLowerCase();
  for (const u of all) {
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
    const evidenceUrls = cand?.evidenceUrls ?? [];
    const mbUrls = cand?.mbUrls ?? [];

    let nextWhy = why;
    if (!whyContainsEvidenceCitation(nextWhy, evidenceUrls, mbUrls)) {
      const fallback = evidenceUrls[0] ?? mbUrls[0];
      if (!fallback) continue;
      nextWhy = `${why} (see ${fallback})`;
    }

    const signals = Array.isArray(row.sourceSignals) ? [...(row.sourceSignals as string[])] : [];
    if (!signals.includes("web_search")) signals.push("web_search");
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

function formatEvidenceForPrompt(candidates: VerifiedCandidate[]): string {
  const lines: string[] = [];
  for (const c of candidates) {
    const name = c.canonicalName || c.name;
    const bits = [
      `artist: ${name}`,
      `verified_in_musicbrainz: ${c.verified}`,
      `evidence_urls: ${c.evidenceUrls.join(" | ")}`,
      `snippets: ${c.evidenceSnippets.join(" / ")}`,
    ];
    if (c.mbTags?.length) bits.push(`mb_tags: ${c.mbTags.join(", ")}`);
    if (c.mbGenres?.length) bits.push(`mb_genres: ${c.mbGenres.join(", ")}`);
    if (c.lifeSpan?.begin) bits.push(`active_from: ${c.lifeSpan.begin}, ended: ${c.lifeSpan.ended}`);
    lines.push(bits.join("\n"));
  }
  return lines.join("\n---\n");
}

const RANK_SYSTEM = [
  'You recommend niche bands using ONLY the evidence block below. Respond with a single JSON object only — never a bare JSON array.',
  'Shape: {"reply":"<string>","recommendations":[{"artist":"<string>","why":"<string>","sourceSignals":["<string>",...]}]}.',
  "The reply must be 2–4 sentences: acknowledge the user's taste, tie picks to their query, ask one follow-up.",
  "Recommendations: at most 3 items. Each why MUST quote or include at least one full URL from evidence_urls for that artist (Bandcamp, blog, etc.).",
  "sourceSignals must include agent_reasoning, web_search, musicbrainz_verification when the candidate was verified, and user_preferences when relevant.",
  "Only recommend artists present in the evidence list; use the exact spelling from evidence.",
].join(" ");

export type CreateRecommendationRankerOptions = {
  apiKey: string;
  timeoutMs?: number;
  model?: string;
};

export async function createRecommendationRanker({
  apiKey,
  timeoutMs = 12000,
  model = "gemini-2.5-flash",
}: CreateRecommendationRankerOptions): Promise<
  (input: {
    query: string;
    preferenceContext: string;
    messages: ChatMessage[];
    mode: RecommendationMode;
    candidates: VerifiedCandidate[];
  }) => Promise<{ recommendations: unknown[]; assistantReply: string }>
> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    throw new Error("apiKey is required for recommendation ranker");
  }

  const modelClient = new ChatGoogleGenerativeAI({
    model,
    apiKey: trimmedKey,
    temperature: 0.35,
  });

  return async function rank(input) {
    const evidence = formatEvidenceForPrompt(input.candidates);
    const wrappedQuery = wrapUserContent(input.query);
    const prefBlock = wrapPreferenceContext(input.preferenceContext);

    const prompt: Array<{ role: string; content: string }> = [
      { role: "system", content: RANK_SYSTEM },
    ];

    let historyChars = 0;
    for (const msg of input.messages) {
      if (msg.role !== "user" && msg.role !== "assistant") continue;
      const content = capAndTrim(escapeEnvelopeChars(String(msg.content ?? "")), 4000);
      if (!content || historyChars + content.length > 7000) break;
      prompt.push({ role: msg.role, content });
      historyChars += content.length;
    }

    const parts = [`query: ${wrappedQuery}`, `mode: ${input.mode}`];
    if (prefBlock) parts.push(prefBlock);
    parts.push(`evidence_candidates:\n${evidence}`, "limit: 3");
    prompt.push({ role: "user", content: parts.join("\n") });

    const response = await withTimeout(modelClient.invoke(prompt), timeoutMs, "recommendation ranker timeout");
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
      const response2 = await withTimeout(modelClient.invoke(retryPrompt), timeoutMs, "recommendation ranker retry");
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

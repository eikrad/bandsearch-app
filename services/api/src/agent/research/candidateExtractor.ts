import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

import { wrapSearchHitBlock } from "../promptGuards.js";
import { parseModelJsonResponse, withTimeout } from "../modelUtils.js";

export const CANDIDATE_EXTRACTOR_MAX_HITS_CHARS = 12000;

export type SearchHitInput = {
  sourceQuery: string;
  title: string;
  url: string;
  description: string;
};

export type ExtractedCandidate = {
  name: string;
  evidenceUrls: string[];
  evidenceSnippets: string[];
  sourceQueries: string[];
};

const SYSTEM = [
  "You extract band or artist names from web search results for music discovery.",
  "Only include names that appear to be musical artists or bands mentioned as recommendations, FFO, RIYL, similar artists, or scene lists.",
  'Output ONLY JSON: {"candidates":[{"name":"","evidenceUrls":[],"evidenceSnippets":[],"sourceQueries":[]}]}',
  "evidenceSnippets should quote short phrases from titles or descriptions (not full pages).",
  "Do not include the anchor/reference bands listed by the user — only other acts.",
  "Deduplicate band names case-insensitively in your output (merge evidence).",
].join(" ");

const RETRY_ADDENDUM =
  "Invalid JSON before. Reply with ONLY one JSON object: " +
  '{"candidates":[{"name":"string","evidenceUrls":["url"],"evidenceSnippets":["text"],"sourceQueries":["query"]}]}';

function normalizeAnchors(anchors: string[]): Set<string> {
  const s = new Set<string>();
  for (const a of anchors) {
    const t = String(a || "").trim().toLowerCase();
    if (t) s.add(t);
  }
  return s;
}

function mergeCandidates(rows: ExtractedCandidate[]): ExtractedCandidate[] {
  const map = new Map<string, ExtractedCandidate>();
  for (const row of rows) {
    const name = String(row.name || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        name,
        evidenceUrls: [...(row.evidenceUrls || [])],
        evidenceSnippets: [...(row.evidenceSnippets || [])],
        sourceQueries: [...(row.sourceQueries || [])],
      });
    } else {
      const urls = new Set(existing.evidenceUrls);
      for (const u of row.evidenceUrls || []) {
        if (typeof u === "string" && u.trim()) urls.add(u.trim());
      }
      existing.evidenceUrls = [...urls];
      const snips = new Set(existing.evidenceSnippets);
      for (const s of row.evidenceSnippets || []) {
        if (typeof s === "string" && s.trim()) snips.add(s.trim());
      }
      existing.evidenceSnippets = [...snips];
      const qs = new Set(existing.sourceQueries);
      for (const q of row.sourceQueries || []) {
        if (typeof q === "string" && q.trim()) qs.add(q.trim());
      }
      existing.sourceQueries = [...qs];
    }
  }
  return [...map.values()];
}

function extractFromParsed(parsed: unknown, anchors: Set<string>): ExtractedCandidate[] {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const list = (parsed as Record<string, unknown>).candidates;
  if (!Array.isArray(list)) return [];
  const out: ExtractedCandidate[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!name || anchors.has(name.toLowerCase())) continue;
    const evidenceUrls = Array.isArray(o.evidenceUrls)
      ? o.evidenceUrls.filter((u): u is string => typeof u === "string" && Boolean(u.trim())).map((u) => u.trim())
      : [];
    const evidenceSnippets = Array.isArray(o.evidenceSnippets)
      ? o.evidenceSnippets.filter((s): s is string => typeof s === "string" && Boolean(s.trim())).map((s) => s.trim())
      : [];
    const sourceQueries = Array.isArray(o.sourceQueries)
      ? o.sourceQueries.filter((s): s is string => typeof s === "string" && Boolean(s.trim())).map((s) => s.trim())
      : [];
    if (evidenceUrls.length === 0 && evidenceSnippets.length === 0) continue;
    out.push({ name, evidenceUrls, evidenceSnippets, sourceQueries });
  }
  return mergeCandidates(out);
}

/** Test helper */
export function tryParseExtractedCandidatesFromModelText(
  raw: string,
  anchorArtists: string[] = [],
): ExtractedCandidate[] {
  try {
    const parsed = parseModelJsonResponse(raw);
    return extractFromParsed(parsed, normalizeAnchors(anchorArtists));
  } catch {
    return [];
  }
}

function formatHitsForPrompt(hits: SearchHitInput[]): string {
  const blocks: string[] = [];
  let total = 0;
  for (const h of hits) {
    const block = wrapSearchHitBlock(h);
    if (total + block.length + 2 > CANDIDATE_EXTRACTOR_MAX_HITS_CHARS) break;
    blocks.push(block);
    total += block.length + 2;
  }
  return blocks.join("\n\n");
}

export type CreateCandidateExtractorOptions = {
  apiKey: string;
  timeoutMs?: number;
  model?: string;
};

export async function createCandidateExtractor({
  apiKey,
  timeoutMs = 12000,
  model = "gemini-2.5-flash",
}: CreateCandidateExtractorOptions): Promise<
  (input: { hits: SearchHitInput[]; anchorArtists: string[] }) => Promise<ExtractedCandidate[]>
> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    throw new Error("apiKey is required for candidate extractor");
  }

  const modelClient = new ChatGoogleGenerativeAI({
    model,
    apiKey: trimmedKey,
    temperature: 0.1,
  });

  async function invokeOnce(
    systemText: string,
    userContent: string,
    anchors: Set<string>,
  ): Promise<ExtractedCandidate[]> {
    const prompt = [
      { role: "system" as const, content: systemText },
      { role: "user" as const, content: userContent },
    ];
    const response = await withTimeout(modelClient.invoke(prompt), timeoutMs, "candidate extractor timeout");
    const raw = typeof response.content === "string" ? response.content : "";
    const parsed = parseModelJsonResponse(raw);
    return extractFromParsed(parsed, anchors);
  }

  return async function extractCandidates(input: {
    hits: SearchHitInput[];
    anchorArtists: string[];
  }): Promise<ExtractedCandidate[]> {
    const anchors = normalizeAnchors(input.anchorArtists || []);
    const hits = Array.isArray(input.hits) ? input.hits : [];
    if (hits.length === 0) return [];

    const hitBlock = formatHitsForPrompt(hits);
    const anchorLine =
      anchors.size > 0
        ? `exclude_anchor_artist_names_case_insensitive: ${[...anchors].join(", ")}`
        : "exclude_anchor_artist_names_case_insensitive: (none)";

    const userContent = `${anchorLine}\n\nsearch_results:\n${hitBlock}`;

    const first = await invokeOnce(SYSTEM, userContent, anchors);
    if (first.length > 0) return first;

    return invokeOnce(`${SYSTEM} ${RETRY_ADDENDUM}`, userContent, anchors);
  };
}

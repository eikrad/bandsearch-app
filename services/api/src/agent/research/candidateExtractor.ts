import { createGeminiChatClient } from "../../llm/geminiChat.js";

import { capAndTrim, wrapSearchHitBlock } from "../promptGuards.js";
import { plainText, wordsAround } from "./textSnippets.js";
import type { ChatModelClient } from "../modelUtils.js";
import { invokeModel, parseModelJsonResponse } from "../modelUtils.js";
import { DEFAULT_RESEARCH_MODEL } from "../../config/models.js";
import type { ChatModelFactory } from "../../llm/chatModel.js";

/** The extractor answers with numbers, so reading more hits costs it little time. */
export const CANDIDATE_EXTRACTOR_MAX_HITS_CHARS = 18000;

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

export const CANDIDATE_EXTRACTOR_DEFAULT_MAX_CANDIDATES = 32;

export function buildExtractorSystemPrompt(maxCandidates: number): string {
  return [
    "You extract band or artist names from web search results for music discovery.",
    "Only include names that appear to be musical artists or bands mentioned as recommendations, FFO, RIYL, similar artists, or scene lists.",
    'Output ONLY JSON: {"candidates":[{"name":"","hits":[]}]}',
    "hits holds the numbers of the search results that mention the act. Do not copy text from the results.",
    "Do not include the anchor/reference bands listed by the user — only other acts.",
    "Deduplicate band names case-insensitively in your output (merge evidence).",
    `Return at most ${maxCandidates} candidates — prioritise the most frequently mentioned and most clearly relevant acts.`,
  ].join(" ");
}

const RETRY_ADDENDUM =
  "Invalid JSON before. Reply with ONLY one JSON object: " +
  '{"candidates":[{"name":"string","hits":[1]}]}';

function normalizeAnchors(anchors: string[]): Set<string> {
  const s = new Set<string>();
  for (const a of anchors) {
    const t = String(a || "").trim().toLowerCase();
    if (t) s.add(t);
  }
  return s;
}

export function mergeExtractedCandidates(rows: ExtractedCandidate[]): ExtractedCandidate[] {
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

/** Evidence per candidate: enough to judge a band by, short enough for the ranker's prompt. */
const MAX_HITS_PER_CANDIDATE = 4;
const MAX_SNIPPETS_PER_CANDIDATE = 2;
const SNIPPET_MAX_CHARS = 180;

/** The words of a hit around the band's name; its title when only that names the band. */
function snippetFor(name: string, hit: SearchHitInput): string {
  const text = plainText(hit.description);
  const at = text.toLowerCase().indexOf(name.toLowerCase());
  if (at !== -1) return wordsAround(text, at, name.length, SNIPPET_MAX_CHARS);
  const title = plainText(hit.title);
  return capAndTrim(title.toLowerCase().includes(name.toLowerCase()) || !text ? title : text, SNIPPET_MAX_CHARS);
}

/** The hits a candidate refers to by number; unknown and repeated numbers are ignored. */
function hitsOf(raw: unknown, hits: SearchHitInput[]): SearchHitInput[] {
  const numbers = new Set((Array.isArray(raw) ? raw : []).map(Number));
  return [...numbers]
    .map((n) => hits[n - 1])
    .filter((hit): hit is SearchHitInput => hit !== undefined)
    .slice(0, MAX_HITS_PER_CANDIDATE);
}

const unique = (values: string[]) => [...new Set(values.map((v) => v.trim()).filter(Boolean))];

function extractFromParsed(parsed: unknown, hits: SearchHitInput[], anchors: Set<string>): ExtractedCandidate[] {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const list = (parsed as Record<string, unknown>).candidates;
  if (!Array.isArray(list)) return [];
  const out: ExtractedCandidate[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!name || anchors.has(name.toLowerCase())) continue;
    const mentions = hitsOf(o.hits, hits);
    if (mentions.length === 0) continue;
    out.push({
      name,
      evidenceUrls: unique(mentions.map((hit) => hit.url)),
      evidenceSnippets: unique(mentions.map((hit) => snippetFor(name, hit))).slice(0, MAX_SNIPPETS_PER_CANDIDATE),
      sourceQueries: unique(mentions.map((hit) => hit.sourceQuery)),
    });
  }
  return mergeExtractedCandidates(out);
}

/** The hits as numbered prompt blocks, and the hits that fit. */
function formatHitsForPrompt(hits: SearchHitInput[]): { text: string; shown: SearchHitInput[] } {
  const blocks: string[] = [];
  let total = 0;
  for (const [i, h] of hits.entries()) {
    const block = wrapSearchHitBlock(h, i + 1);
    if (total + block.length + 2 > CANDIDATE_EXTRACTOR_MAX_HITS_CHARS) break;
    blocks.push(block);
    total += block.length + 2;
  }
  return { text: blocks.join("\n\n"), shown: hits.slice(0, blocks.length) };
}

export type CreateCandidateExtractorOptions = {
  apiKey: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  model?: string;
  /** Upper bound on candidates the model should emit; smaller = faster generation. */
  maxCandidates?: number;
  /**
   * Chat model to use. Defaults to Gemini built from `apiKey`; supply one to
   * drive this factory's closure without a key or a network call.
   */
  modelClient?: ChatModelClient;
  /** Builds this node's model from the configured provider (llm/chatModel.ts). */
  chatModel?: ChatModelFactory;
};

export async function createCandidateExtractor({
  apiKey,
  timeoutMs = 12000,
  signal,
  model = DEFAULT_RESEARCH_MODEL,
  maxCandidates = CANDIDATE_EXTRACTOR_DEFAULT_MAX_CANDIDATES,
  modelClient: injectedModelClient,
  chatModel,
}: CreateCandidateExtractorOptions): Promise<
  (input: { hits: SearchHitInput[]; anchorArtists: string[] }) => Promise<ExtractedCandidate[]>
> {
  // An injected client stands in for Gemini entirely, so it needs no key.
  const trimmedKey = apiKey.trim();
  if (!injectedModelClient && !chatModel && !trimmedKey) {
    throw new Error("apiKey is required for candidate extractor");
  }

  const temperature = 0.1;
  const modelClient: ChatModelClient = injectedModelClient ?? chatModel?.({ temperature }) ?? createGeminiChatClient({
    model,
    apiKey: trimmedKey,
    temperature,
  });

  const systemPrompt = buildExtractorSystemPrompt(maxCandidates);

  async function invokeOnce(
    systemText: string,
    userContent: string,
    shown: SearchHitInput[],
    anchors: Set<string>,
  ): Promise<ExtractedCandidate[]> {
    const prompt = [
      { role: "system" as const, content: systemText },
      { role: "user" as const, content: userContent },
    ];
    const response = await invokeModel(modelClient, prompt, { signal, timeoutMs, timeoutMessage: "candidate extractor timeout" });
    const raw = typeof response.content === "string" ? response.content : "";
    const parsed = parseModelJsonResponse(raw);
    // Hard cap as a safety net in case the model exceeds the requested count.
    return extractFromParsed(parsed, shown, anchors).slice(0, maxCandidates);
  }

  return async function extractCandidates(input: {
    hits: SearchHitInput[];
    anchorArtists: string[];
  }): Promise<ExtractedCandidate[]> {
    const anchors = normalizeAnchors(input.anchorArtists || []);
    const hits = Array.isArray(input.hits) ? input.hits : [];
    if (hits.length === 0) return [];

    const { text: hitBlock, shown } = formatHitsForPrompt(hits);
    const anchorLine =
      anchors.size > 0
        ? `exclude_anchor_artist_names_case_insensitive: ${[...anchors].join(", ")}`
        : "exclude_anchor_artist_names_case_insensitive: (none)";

    const userContent = `${anchorLine}\n\nsearch_results:\n${hitBlock}`;

    const first = await invokeOnce(systemPrompt, userContent, shown, anchors);
    if (first.length > 0) return first;

    return invokeOnce(`${systemPrompt} ${RETRY_ADDENDUM}`, userContent, shown, anchors);
  };
}

import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import * as z from "zod";

import type { ChatMessage, RecommendationMode } from "../../../../../shared/schemas/src/contracts.js";
import { createBraveSearchClient } from "../../integrations/braveSearch.js";
import { createLastFmClient, type LastFmClient } from "../../eval/lastFmClient.js";
import { createMusicBrainzClient } from "../../integrations/musicbrainz.js";
import { createCandidateExtractor, type ExtractedCandidate, type SearchHitInput } from "./candidateExtractor.js";
import { filterCandidatesByObscurity, verifyCandidatesWithMusicBrainz, type VerifiedCandidate } from "./candidateVerifier.js";
import { createRecommendationRanker } from "./recommendationRanker.js";
import { buildReflectionSubgraph } from "./reflectionSubgraph.js";
import { createResearchBudget, type ResearchBudget } from "./researchBudget.js";
import { createWebSearchPlanner, type SearchPlan } from "./webSearchPlanner.js";

export type ResearchGraphDeps = {
  geminiApiKey: string;
  braveApiKey: string;
  lastFmApiKey?: string;
  maxInitialSearches: number;
  maxReflectionSearches: number;
  totalSearchBudget: number;
  targetVerifiedCount: number;
  researchTimeoutMs: number;
  /** Cap on search hits fed into the candidate extractor; limits output size and latency. */
  maxExtractHits?: number;
  musicBrainzTimeoutMs?: number;
  musicBrainzRetries?: number;
  onLog?: (
    level: "info" | "warn",
    event: string,
    details: Record<string, unknown>,
  ) => void;
};

export type ResearchGraphInput = {
  userQuery: string;
  preferenceContext: string;
  messages: ChatMessage[];
  mode: RecommendationMode;
  obscurityTarget?: string;
};

export const RESEARCH_SCHEMA = new StateSchema({
  userQuery: z.string(),
  preferenceContext: z.string(),
  messages: z.custom<ChatMessage[]>(),
  mode: z.custom<RecommendationMode>(),
  obscurityTarget: z.string().optional(),
  searchPlan: z.custom<SearchPlan | undefined>(),
  braveHits: z.custom<SearchHitInput[]>(),
  newHits: z.custom<SearchHitInput[]>(),
  searchCallsUsed: z.number(),
  extractedCandidates: z.custom<ExtractedCandidate[]>(),
  verifiedCandidates: z.custom<VerifiedCandidate[]>(),
  reflectionUsed: z.boolean(),
  roundsCompleted: z.number(),
  nextExtraQueries: z.array(z.string()),
  recommendations: z.custom<unknown[]>(),
  assistantReply: z.string(),
});

export type ResearchGraphState = typeof RESEARCH_SCHEMA.State;

type BraveDedupCache = Map<string, { results: Array<{ title: string; url: string; description: string }> }>;

async function runBraveQueries(
  config: { apiKey: string; dedupCache: BraveDedupCache; budget: ResearchBudget },
  queries: string[],
  budgetLeft: number,
  perQueryCount: number,
): Promise<{ hits: SearchHitInput[]; calls: number }> {
  const brave = createBraveSearchClient({
    apiKey: config.apiKey,
    timeoutMs: config.budget.allocate(10000),
    retries: 1,
    dedupCache: config.dedupCache,
  });
  const hits: SearchHitInput[] = [];
  let calls = 0;
  for (const q of queries) {
    if (calls >= budgetLeft) break;
    const res = await brave.search(q, { count: perQueryCount });
    calls += 1;
    for (const r of res.results) {
      hits.push({ sourceQuery: q, title: r.title, url: r.url, description: r.description });
    }
  }
  return { hits, calls };
}

export async function buildResearchGraph(deps: ResearchGraphDeps, budget: ResearchBudget) {
  const log = deps.onLog ?? (() => {});

  const mb = createMusicBrainzClient({
    timeoutMs: deps.musicBrainzTimeoutMs ?? 5000,
    retries: deps.musicBrainzRetries ?? 1,
  });

  const lastFm: LastFmClient | null = deps.lastFmApiKey
    ? createLastFmClient({ apiKey: deps.lastFmApiKey, timeoutMs: 5000 })
    : null;

  const braveDedup: BraveDedupCache = new Map();
  const runQueries = (queries: string[], budgetLeft: number, perQueryCount: number) =>
    runBraveQueries({ apiKey: deps.braveApiKey, dedupCache: braveDedup, budget }, queries, budgetLeft, perQueryCount);

  const reflectionSubgraph = buildReflectionSubgraph({
    geminiApiKey: deps.geminiApiKey,
    mb,
    runQueries,
    budget,
    maxRounds: 2,
    maxReflectionSearches: deps.maxReflectionSearches,
    targetVerifiedCount: deps.targetVerifiedCount,
    totalSearchBudget: deps.totalSearchBudget,
    onLog: deps.onLog,
  });

  const graph = new StateGraph(RESEARCH_SCHEMA)
    .addNode("plan", async (state) => {
      const planWeb = await createWebSearchPlanner({
        apiKey: deps.geminiApiKey,
        timeoutMs: budget.allocate(20000),
      });
      const plan = await planWeb({
        userQuery: state.userQuery,
        preferenceContext: state.preferenceContext,
        messages: state.messages,
        obscurityTarget: state.obscurityTarget,
      });
      log("info", "research_plan_resolved", {
        anchorCount: plan.anchorArtists.length,
        queryCount: plan.queries.length,
      });
      return { searchPlan: plan };
    })
    .addNode("brave_initial", async (state) => {
      const slice = state.searchPlan?.queries.slice(0, deps.maxInitialSearches) ?? [];
      const { hits, calls } = await runQueries(slice, deps.totalSearchBudget, 8);
      log("info", "research_brave_call", { phase: "initial", calls, hitCount: hits.length });
      return { braveHits: hits, searchCallsUsed: calls };
    })
    .addNode("extract", async (state) => {
      const extract = await createCandidateExtractor({
        apiKey: deps.geminiApiKey,
        timeoutMs: budget.allocate(18000),
      });
      const anchors = state.searchPlan?.anchorArtists?.length ? state.searchPlan.anchorArtists : [];
      // Cap hits so the model emits a manageable candidate list within the timeout.
      const maxExtractHits = deps.maxExtractHits ?? 24;
      const hitsForExtract = Array.isArray(state.braveHits) ? state.braveHits.slice(0, maxExtractHits) : [];
      const candidates = await extract({ hits: hitsForExtract, anchorArtists: anchors });
      log("info", "research_candidates_extracted", { count: candidates.length });
      return { extractedCandidates: candidates };
    })
    .addNode("verify", async (state) => {
      const anchors = state.searchPlan?.anchorArtists ?? [];
      const verified = await verifyCandidatesWithMusicBrainz(mb, state.extractedCandidates, anchors);
      const verifiedCount = verified.filter((v) => v.verified).length;
      log("info", "research_verification_done", {
        phase: "initial",
        verified: verifiedCount,
        total: verified.length,
      });
      return { verifiedCandidates: verified };
    })
    .addNode("reflect_if_needed", reflectionSubgraph)
    .addNode("enrich_lastfm", async (state) => {
      if (!lastFm) return {};
      const anchors = state.searchPlan?.anchorArtists ?? [];
      if (!state.verifiedCandidates?.length) return {};

      // Fetch similar-artist signals and listener counts in parallel.
      const [similarResults, listenerResults] = await Promise.all([
        anchors.length
          ? Promise.all(anchors.map((a) => lastFm.getSimilarArtists(a)))
          : Promise.resolve([]),
        Promise.allSettled(
          state.verifiedCandidates.map((c) =>
            lastFm.getListenerCount(c.canonicalName || c.name),
          ),
        ),
      ]);

      const similarMap = new Map<string, { anchor: string; match: number }>();
      for (let i = 0; i < anchors.length; i++) {
        for (const s of similarResults[i] ?? []) {
          const key = s.name.toLowerCase();
          const existing = similarMap.get(key);
          if (!existing || s.match > existing.match) {
            similarMap.set(key, { anchor: anchors[i], match: s.match });
          }
        }
      }

      let matchCount = 0;
      const enriched = state.verifiedCandidates.map((c, idx) => {
        const key = (c.canonicalName || c.name).trim().toLowerCase();
        const hit = similarMap.get(key);
        const listenerCount =
          listenerResults[idx].status === "fulfilled" ? listenerResults[idx].value : null;

        let next: VerifiedCandidate = { ...c, listenerCount };
        if (hit) {
          matchCount++;
          const similarUrl = `https://www.last.fm/music/${encodeURIComponent(hit.anchor)}/+similar`;
          next = {
            ...next,
            evidenceUrls: [...next.evidenceUrls, similarUrl],
            evidenceSnippets: [...next.evidenceSnippets, `Similar to ${hit.anchor} on last.fm (match: ${hit.match.toFixed(2)})`],
          };
        }
        return next;
      });

      log("info", "research_lastfm_enrichment", {
        anchorCount: anchors.length,
        candidateCount: state.verifiedCandidates.length,
        matchCount,
        listenersFetched: listenerResults.filter((r) => r.status === "fulfilled" && r.value != null).length,
      });
      return { verifiedCandidates: enriched };
    })
    .addNode("rank", async (state) => {
      const ranker = await createRecommendationRanker({
        apiKey: deps.geminiApiKey,
        timeoutMs: Math.max(budget.allocate(12000), 12000),
      });
      const filteredCandidates = filterCandidatesByObscurity(state.verifiedCandidates, state.obscurityTarget);
      log("info", "research_obscurity_filter", {
        obscurityTarget: state.obscurityTarget ?? "none",
        before: state.verifiedCandidates.length,
        after: filteredCandidates.length,
      });
      const { recommendations, assistantReply } = await ranker({
        query: state.userQuery,
        preferenceContext: state.preferenceContext,
        messages: state.messages,
        mode: state.mode,
        candidates: filteredCandidates,
        obscurityTarget: state.obscurityTarget,
      });
      log("info", "research_ranked", {
        finalCount: Array.isArray(recommendations) ? recommendations.length : 0,
      });
      return { recommendations, assistantReply };
    })
    .addEdge(START, "plan")
    .addEdge("plan", "brave_initial")
    .addEdge("brave_initial", "extract")
    .addEdge("extract", "verify")
    .addEdge("verify", "reflect_if_needed")
    .addEdge("reflect_if_needed", "enrich_lastfm")
    .addEdge("enrich_lastfm", "rank")
    .addEdge("rank", END);

  return graph.compile();
}

export type PipelineDiagnostics = {
  braveHitCount: number;
  extractedCandidateCount: number;
  verifiedCount: number;
  reflectionTriggered: boolean;
  searchBudgetUsed: number;
};

export async function invokeResearchGraph(
  deps: ResearchGraphDeps,
  input: ResearchGraphInput,
): Promise<{ recommendations: unknown[]; assistantReply: string; pipelineDiagnostics: PipelineDiagnostics }> {
  const budget = createResearchBudget(deps.researchTimeoutMs);
  const graph = await buildResearchGraph(deps, budget);
  const result = await graph.invoke({
    userQuery: input.userQuery,
    preferenceContext: input.preferenceContext,
    messages: input.messages,
    mode: input.mode,
    obscurityTarget: input.obscurityTarget,
    braveHits: [],
    newHits: [],
    searchCallsUsed: 0,
    extractedCandidates: [],
    verifiedCandidates: [],
    reflectionUsed: false,
    roundsCompleted: 0,
    nextExtraQueries: [],
    recommendations: [],
    assistantReply: "",
  });

  const pipelineDiagnostics: PipelineDiagnostics = {
    braveHitCount: Array.isArray(result.braveHits) ? result.braveHits.length : 0,
    extractedCandidateCount: Array.isArray(result.extractedCandidates) ? result.extractedCandidates.length : 0,
    verifiedCount: Array.isArray(result.verifiedCandidates)
      ? result.verifiedCandidates.filter((v: VerifiedCandidate) => v.verified).length
      : 0,
    reflectionTriggered: Boolean(result.reflectionUsed),
    searchBudgetUsed: typeof result.searchCallsUsed === "number" ? result.searchCallsUsed : 0,
  };

  return {
    recommendations: Array.isArray(result.recommendations) ? result.recommendations : [],
    assistantReply: typeof result.assistantReply === "string" ? result.assistantReply : "",
    pipelineDiagnostics,
  };
}

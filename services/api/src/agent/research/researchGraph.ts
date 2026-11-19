import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import * as z from "zod";

import type { ChatMessage, RecommendationMode } from "../../../../../shared/schemas/src/contracts.js";
import { errorMessage, type ChatModelClient } from "../modelUtils.js";
import { createBraveSearchClient } from "../../integrations/braveSearch.js";
import { createLastFmClient, type LastFmClient } from "../../eval/lastFmClient.js";
import { createMusicBrainzClient } from "../../integrations/musicbrainz.js";
import { createCandidateExtractor, type ExtractedCandidate, type SearchHitInput } from "./candidateExtractor.js";
import { filterCandidatesByObscurity, verifyCandidatesWithMusicBrainz, type VerifiedCandidate } from "./candidateVerifier.js";
import { fitObscurityTarget, type ObscurityTargetFit } from "../../obscurityTargets.js";
import { createRecommendationRanker } from "./recommendationRanker.js";
import { buildReflectionSubgraph } from "./reflectionSubgraph.js";
import { createResearchBudget, RANKING_RESERVE_MS, type ResearchBudget } from "./researchBudget.js";
import { createWebSearchPlanner, fallbackSearchPlan, type SearchPlan } from "./webSearchPlanner.js";
import { DEFAULT_RESEARCH_MODEL } from "../../config/models.js";
import type { ChatModelFactory } from "../../llm/chatModel.js";

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
  /** Spacing of MusicBrainz calls; 0 when the transport already spaces real calls (replay). */
  musicBrainzMinIntervalMs?: number;
  /**
   * Chat model for every Gemini-backed node. Defaults to Gemini built from
   * `geminiApiKey`; supply one to run the graph without a key or a network call.
   */
  modelClient?: ChatModelClient;
  /** Builds each node's model from the configured provider; used when no `modelClient` is given. */
  chatModel?: ChatModelFactory;
  /**
   * Model id for every research node; defaults to `DEFAULT_RESEARCH_MODEL`.
   * Reported back as the run's `model`, the provenance of the ranker's prose.
   */
  model?: string;
  /** Transport for the Brave, MusicBrainz and Last.fm clients. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
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
  config: { apiKey: string; dedupCache: BraveDedupCache; budget: ResearchBudget; fetchImpl?: typeof fetch },
  queries: string[],
  budgetLeft: number,
  perQueryCount: number,
): Promise<{ hits: SearchHitInput[]; calls: number }> {
  const brave = createBraveSearchClient({
    apiKey: config.apiKey,
    timeoutMs: config.budget.allocate(10000),
    retries: 1,
    dedupCache: config.dedupCache,
    fetchImpl: config.fetchImpl,
  });
  const hits: SearchHitInput[] = [];
  let calls = 0;
  for (const q of queries) {
    if (calls >= budgetLeft || config.budget.remaining() <= 0) break;
    let res;
    calls += 1;
    try {
      res = await config.budget.run(config.budget.remaining(), (signal) =>
        brave.search(q, { count: perQueryCount, signal }));
    } catch (error) {
      if (config.budget.remaining() <= 0) break;
      throw error;
    }
    for (const r of res.results) {
      hits.push({ sourceQuery: q, title: r.title, url: r.url, description: r.description });
    }
  }
  return { hits, calls };
}

export async function buildResearchGraph(deps: ResearchGraphDeps, budget: ResearchBudget) {
  const log = deps.onLog ?? (() => {});

  // Research ends early so final ranking always has its reserve within the total deadline.
  const researchScope = budget.reserve(RANKING_RESERVE_MS);
  const musicBrainzFor = (signal: AbortSignal) => createMusicBrainzClient({
    timeoutMs: deps.musicBrainzTimeoutMs ?? 5000,
    retries: deps.musicBrainzRetries ?? 1,
    fetchImpl: deps.fetchImpl,
    signal,
    ...(deps.musicBrainzMinIntervalMs !== undefined ? { minIntervalMs: deps.musicBrainzMinIntervalMs } : {}),
  });
  const mb = {
    searchArtists: (query: string) => researchScope.run(researchScope.remaining(), (signal) => musicBrainzFor(signal).searchArtists(query)),
    lookupArtist: (id: string) => researchScope.run(researchScope.remaining(), (signal) => musicBrainzFor(signal).lookupArtist(id)),
  };

  // At the research cutoff every remaining stage is skipped and the graph ranks what it has.
  const untilCutoff = <Next extends string>(next: Next): [() => Next | "rank", Array<Next | "rank">] =>
    [() => (researchScope.remaining() > 0 ? next : "rank"), [next, "rank"]];

  const braveDedup: BraveDedupCache = new Map();
  const runQueries = (queries: string[], budgetLeft: number, perQueryCount: number) =>
    runBraveQueries({ apiKey: deps.braveApiKey, dedupCache: braveDedup, budget: researchScope, fetchImpl: deps.fetchImpl }, queries, budgetLeft, perQueryCount);

  const reflectionSubgraph = buildReflectionSubgraph({
    geminiApiKey: deps.geminiApiKey,
    mb,
    runQueries,
    budget: researchScope,
    maxRounds: 2,
    maxReflectionSearches: deps.maxReflectionSearches,
    targetVerifiedCount: deps.targetVerifiedCount,
    totalSearchBudget: deps.totalSearchBudget,
    onLog: deps.onLog,
    modelClient: deps.modelClient,
    chatModel: deps.chatModel,
    model: deps.model,
  });

  const graph = new StateGraph(RESEARCH_SCHEMA)
    .addNode("plan", async (state) => researchScope.run(20000, async (signal) => {
      const planWeb = await createWebSearchPlanner({
        apiKey: deps.geminiApiKey,
        timeoutMs: researchScope.allocate(20000),
        signal,
        modelClient: deps.modelClient,
        chatModel: deps.chatModel,
        model: deps.model,
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
    }).catch((error: unknown) => {
      // Broad searches can still succeed when planning fails within its cap.
      log("warn", "research_plan_fallback", { reason: errorMessage(error) });
      return { searchPlan: fallbackSearchPlan(state.userQuery, state.obscurityTarget) };
    }))
    .addNode("brave_initial", async (state) => {
      const slice = state.searchPlan?.queries.slice(0, deps.maxInitialSearches) ?? [];
      const { hits, calls } = await runQueries(slice, deps.totalSearchBudget, 8);
      log("info", "research_brave_call", { phase: "initial", calls, hitCount: hits.length });
      return { braveHits: hits, searchCallsUsed: calls };
    })
    .addNode("extract", async (state) => researchScope.run(18000, async (signal) => {
      const extract = await createCandidateExtractor({
        apiKey: deps.geminiApiKey,
        timeoutMs: researchScope.allocate(18000),
        signal,
        modelClient: deps.modelClient,
        chatModel: deps.chatModel,
        model: deps.model,
      });
      const anchors = state.searchPlan?.anchorArtists?.length ? state.searchPlan.anchorArtists : [];
      // Cap hits so the model emits a manageable candidate list within the timeout.
      const maxExtractHits = deps.maxExtractHits ?? 24;
      const hitsForExtract = Array.isArray(state.braveHits) ? state.braveHits.slice(0, maxExtractHits) : [];
      const candidates = await extract({ hits: hitsForExtract, anchorArtists: anchors });
      log("info", "research_candidates_extracted", { count: candidates.length });
      return { extractedCandidates: candidates };
    }).catch((error: unknown) => {
      if (researchScope.remaining() > 0) throw error;
      return {};
    }))
    .addNode("verify", async (state) => {
      const anchors = state.searchPlan?.anchorArtists ?? [];
      const verified = await verifyCandidatesWithMusicBrainz(mb, state.extractedCandidates, anchors, { shouldContinue: () => researchScope.remaining() > 0 });
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
      const apiKey = deps.lastFmApiKey;
      if (!apiKey || researchScope.remaining() <= 0) return {};
      return researchScope.run(5000, async (signal) => {
        const lastFm: LastFmClient = createLastFmClient({ apiKey, timeoutMs: 5000, fetchImpl: deps.fetchImpl, signal });
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
      }).catch((error: unknown) => {
        log("warn", "research_lastfm_skipped", { reason: errorMessage(error) });
        return {};
      });
    })
    .addNode("rank", async (state) => budget.run(RANKING_RESERVE_MS, async (signal) => {
      const ranker = await createRecommendationRanker({
        apiKey: deps.geminiApiKey,
        timeoutMs: budget.allocate(RANKING_RESERVE_MS),
        signal,
        modelClient: deps.modelClient,
        chatModel: deps.chatModel,
        model: deps.model,
      });
      const filteredCandidates = filterCandidatesByObscurity(state.verifiedCandidates, state.obscurityTarget);
      log("info", "research_obscurity_filter", {
        obscurityTarget: state.obscurityTarget ?? "none",
        before: state.verifiedCandidates.length,
        after: filteredCandidates.length,
        // Shows whether in-range bands were found and filtered or ranked away, or never found (#325).
        fitBefore: countTargetFit(state.verifiedCandidates, state.obscurityTarget),
        fitAfter: countTargetFit(filteredCandidates, state.obscurityTarget),
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
    }))
    .addEdge(START, "plan")
    .addConditionalEdges("plan", ...untilCutoff("brave_initial"))
    .addConditionalEdges("brave_initial", ...untilCutoff("extract"))
    .addConditionalEdges("extract", ...untilCutoff("verify"))
    .addConditionalEdges("verify", ...untilCutoff("reflect_if_needed"))
    .addConditionalEdges("reflect_if_needed", ...untilCutoff("enrich_lastfm"))
    .addEdge("enrich_lastfm", "rank")
    .addEdge("rank", END);

  return graph.compile();
}

/** Candidates per fit against the requested target's range, by the filter's own rule; null when there is nothing to fit. */
function countTargetFit(
  candidates: VerifiedCandidate[],
  target: string | undefined,
): Record<ObscurityTargetFit, number> | null {
  const fits = fitObscurityTarget(candidates.map((c) => c.listenerCount), target);
  if (!fits) return null;
  const counts: Record<ObscurityTargetFit, number> = { inRange: 0, tooObscure: 0, tooMainstream: 0 };
  for (const { fit } of fits) counts[fit]++;
  return counts;
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
): Promise<{
  recommendations: unknown[];
  assistantReply: string;
  pipelineDiagnostics: PipelineDiagnostics;
  /** The model that wrote the ranker's prose — the run's provenance. */
  model: string;
}> {
  const budget = createResearchBudget(deps.researchTimeoutMs);
  try {
    const graph = await buildResearchGraph(deps, budget);
    const result = await budget.run(budget.remaining(), (signal) => graph.invoke({
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
    }, { signal }));

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
      // Every node runs on deps.model today. Should they ever diverge, this must
      // name the ranker's model: the ranker writes the user-visible `why` prose.
      model: deps.model ?? DEFAULT_RESEARCH_MODEL,
    };
  } finally {
    budget.close();
  }
}

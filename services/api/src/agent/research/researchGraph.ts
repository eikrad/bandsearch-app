import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import * as z from "zod";

import type { ChatMessage, RecommendationMode } from "../../../../../shared/schemas/src/contracts.js";
import { errorMessage, type ChatModelClient } from "../modelUtils.js";
import { createBraveSearchClient } from "../../integrations/braveSearch.js";
import { createLastFmClient } from "../../eval/lastFmClient.js";
import { createMusicBrainzClient } from "../../integrations/musicbrainz.js";
import { createCandidateExtractor, type ExtractedCandidate, type SearchHitInput } from "./candidateExtractor.js";
import { filterCandidatesByObscurity, verifyCandidatesWithMusicBrainz, type VerifiedCandidate } from "./candidateVerifier.js";
import { fitObscurityTarget, type ObscurityTargetFit } from "../../obscurityTargets.js";
import { createLastFmEnrichment } from "./lastFmEnrichment.js";
import { createRecommendationRanker } from "./recommendationRanker.js";
import { buildReflectionSubgraph } from "./reflectionSubgraph.js";
import { createResearchBudget, RANKING_RESERVE_MS, type ResearchBudget } from "./researchBudget.js";
import type { ResearchCache } from "./researchCache.js";
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
  /** Search hits the candidate extractor reads per round; searching stops once they are found. */
  maxExtractHits?: number;
  musicBrainzTimeoutMs?: number;
  musicBrainzRetries?: number;
  /** Spacing of MusicBrainz calls; 0 when the transport already spaces real calls (replay). */
  musicBrainzMinIntervalMs?: number;
  /** Spacing of Brave calls; 0 when the transport already spaces real calls (replay). */
  braveMinIntervalMs?: number;
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
  /** Artist facts shared by the searches of this process; without it every search asks again. */
  cache?: ResearchCache;
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
  /** Bands the user has already been shown, in lower case: never ranked again. */
  excludeNames?: ReadonlySet<string>;
};

export const RESEARCH_SCHEMA = new StateSchema({
  userQuery: z.string(),
  preferenceContext: z.string(),
  messages: z.custom<ChatMessage[]>(),
  mode: z.custom<RecommendationMode>(),
  obscurityTarget: z.string().optional(),
  excludeNames: z.custom<ReadonlySet<string> | undefined>(),
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
  config: {
    apiKey: string;
    dedupCache: BraveDedupCache;
    budget: ResearchBudget;
    enoughHits: number;
    minIntervalMs?: number;
    fetchImpl?: typeof fetch;
  },
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
    minIntervalMs: config.minIntervalMs,
  });
  const hits: SearchHitInput[] = [];
  let calls = 0;
  for (const q of queries) {
    if (calls >= budgetLeft || hits.length >= config.enoughHits || config.budget.remaining() <= 0) break;
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
    findArtistsByName: (names: string[], options?: { includeAliases?: boolean }) =>
      researchScope.run(researchScope.remaining(), (signal) => musicBrainzFor(signal).findArtistsByName(names, options)),
  };

  const lastFmKey = deps.lastFmApiKey;
  const lastFm = lastFmKey
    ? createLastFmEnrichment({
        clientFor: (signal) => createLastFmClient({ apiKey: lastFmKey, timeoutMs: 5000, fetchImpl: deps.fetchImpl, signal }),
        budget: researchScope,
        cache: deps.cache,
        log,
      })
    : null;

  // At the research cutoff every remaining stage is skipped and the graph ranks what it has.
  const untilCutoff = <Next extends string>(next: Next): [() => Next | "rank", Array<Next | "rank">] =>
    [() => (researchScope.remaining() > 0 ? next : "rank"), [next, "rank"]];

  // More hits would not reach the extractor: it caps them, so its candidate
  // list stays manageable within the timeout. Searching for them only takes time.
  const maxExtractHits = deps.maxExtractHits ?? 24;
  const braveDedup: BraveDedupCache = new Map();
  const runQueries = (queries: string[], budgetLeft: number, perQueryCount: number) =>
    runBraveQueries({
      apiKey: deps.braveApiKey,
      dedupCache: braveDedup,
      budget: researchScope,
      enoughHits: maxExtractHits,
      minIntervalMs: deps.braveMinIntervalMs,
      fetchImpl: deps.fetchImpl,
    }, queries, budgetLeft, perQueryCount);

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
    artistCache: deps.cache?.artists,
    onExtracted: (candidates) => lastFm?.prefetchListeners(candidates.map((c) => c.name)),
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
        maxQueries: deps.maxInitialSearches,
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
      lastFm?.prefetchSimilar(plan.anchorArtists);
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
      const hitsForExtract = Array.isArray(state.braveHits) ? state.braveHits.slice(0, maxExtractHits) : [];
      const candidates = await extract({ hits: hitsForExtract, anchorArtists: anchors });
      log("info", "research_candidates_extracted", { count: candidates.length });
      lastFm?.prefetchListeners(candidates.map((c) => c.name));
      return { extractedCandidates: candidates };
    }).catch((error: unknown) => {
      if (researchScope.remaining() > 0) throw error;
      return {};
    }))
    .addNode("verify", async (state) => {
      const anchors = state.searchPlan?.anchorArtists ?? [];
      const verified = await verifyCandidatesWithMusicBrainz(mb, state.extractedCandidates, anchors, {
        shouldContinue: () => researchScope.remaining() > 0,
        cache: deps.cache?.artists,
      });
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
      return { verifiedCandidates: await lastFm.enrich(state.verifiedCandidates ?? [], state.searchPlan?.anchorArtists ?? []) };
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
      const fresh = withoutNames(state.verifiedCandidates, state.excludeNames);
      const filteredCandidates = filterCandidatesByObscurity(fresh, state.obscurityTarget);
      log("info", "research_obscurity_filter", {
        obscurityTarget: state.obscurityTarget ?? "none",
        before: fresh.length,
        after: filteredCandidates.length,
        // Shows whether in-range bands were found and filtered or ranked away, or never found (#325).
        fitBefore: countTargetFit(fresh, state.obscurityTarget),
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

/** The candidates not known under any of the names (lower case). */
function withoutNames(candidates: VerifiedCandidate[], names: ReadonlySet<string> | undefined): VerifiedCandidate[] {
  if (!names?.size) return candidates;
  return candidates.filter((c) => ![c.name, c.canonicalName ?? c.name].some((n) => names.has(n.trim().toLowerCase())));
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
  /** Every candidate found, with its evidence: what a follow-up can pick from. */
  candidates: VerifiedCandidate[];
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
      excludeNames: input.excludeNames,
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
      candidates: Array.isArray(result.verifiedCandidates) ? result.verifiedCandidates : [],
      pipelineDiagnostics,
      // Every node runs on deps.model today. Should they ever diverge, this must
      // name the ranker's model: the ranker writes the user-visible `why` prose.
      model: deps.model ?? DEFAULT_RESEARCH_MODEL,
    };
  } finally {
    budget.close();
  }
}

import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import * as z from "zod";

import { findArtist, mayBeSameArtist, type ArtistRef } from "../../../../../shared/schemas/src/artistIdentity.js";
import type { AnswerProgress, ChatMessage, Recommendation, RecommendationMode } from "../../../../../shared/schemas/src/contracts.js";
import { errorMessage, type ChatModelClient } from "../modelUtils.js";
import { createBraveSearchClient } from "../../integrations/braveSearch.js";
import { createLastFmClient } from "../../eval/lastFmClient.js";
import { createMusicBrainzClient } from "../../integrations/musicbrainz.js";
import { createCandidateExtractor, mergeExtractedCandidates, type ExtractedCandidate, type SearchHitInput } from "./candidateExtractor.js";
import { filterCandidatesByObscurity, mergeVerifiedCandidates, verifyCandidatesWithMusicBrainz, type VerifiedCandidate } from "./candidateVerifier.js";
import { fitObscurityTarget, type ObscurityTargetFit } from "../../obscurityTargets.js";
import { createLastFmEnrichment } from "./lastFmEnrichment.js";
import { asksLastFmFirst, enoughFromLastFm } from "./lastFmFirst.js";
import { createRecommendationRanker } from "./recommendationRanker.js";
import { buildReflectionSubgraph } from "./reflectionSubgraph.js";
import { createResearchBudget, RANKING_RESERVE_MS, type ResearchBudget } from "./researchBudget.js";
import type { ResearchCache } from "./researchCache.js";
import { createWebSearchPlanner, fallbackSearchPlan, type SearchPlan } from "./webSearchPlanner.js";
import type { ChatModelFactory } from "../../llm/chatModel.js";

export type ResearchGraphDeps = {
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
   * A ready chat model for every research node; supply one to run the graph
   * without a network call. One of this and `chatModel` is required.
   */
  modelClient?: ChatModelClient;
  /** Builds each node's model from the configured provider; used when no `modelClient` is given. */
  chatModel?: ChatModelFactory;
  /**
   * Model id the research nodes run on. Reported back as the run's `model`,
   * the provenance of the ranker's prose (#134).
   */
  model: string;
  /** Artist facts shared by the searches of this process; without it every search asks again. */
  cache?: ResearchCache;
  /** Transport for the Brave, MusicBrainz and Last.fm clients. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Told what the run is doing, and the reply while it is written. */
  onProgress?: (progress: AnswerProgress) => void;
  onReply?: (text: string) => void;
  /** Ends the run early, as when the user stopped waiting. */
  signal?: AbortSignal;
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
  /** Bands the user has already been shown: never ranked again, under any spelling of them. */
  exclude?: readonly ArtistRef[];
};

export const RESEARCH_SCHEMA = new StateSchema({
  userQuery: z.string(),
  preferenceContext: z.string(),
  messages: z.custom<ChatMessage[]>(),
  mode: z.custom<RecommendationMode>(),
  obscurityTarget: z.string().optional(),
  exclude: z.custom<readonly ArtistRef[] | undefined>(),
  searchPlan: z.custom<SearchPlan | undefined>(),
  /** Last.fm alone found enough bands of the requested size: no web search. */
  enoughFromLastFm: z.boolean(),
  braveHits: z.custom<SearchHitInput[]>(),
  newHits: z.custom<SearchHitInput[]>(),
  searchCallsUsed: z.number(),
  extractedCandidates: z.custom<ExtractedCandidate[]>(),
  verifiedCandidates: z.custom<VerifiedCandidate[]>(),
  reflectionUsed: z.boolean(),
  roundsCompleted: z.number(),
  nextExtraQueries: z.array(z.string()),
  recommendations: z.custom<Recommendation[]>(),
  assistantReply: z.string(),
});

export type ResearchGraphState = typeof RESEARCH_SCHEMA.State;

/** A Brave request costs the same, in time and quota, however many hits it returns. */
export const HITS_PER_SEARCH = 12;

/** Bands of a Last.fm round that was not enough, beside the web search's own. */
const MAX_KEPT_FROM_LASTFM = 12;

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
  const maxExtractHits = deps.maxExtractHits ?? 36;
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
    mb,
    runQueries,
    budget: researchScope,
    maxRounds: 2,
    maxReflectionSearches: deps.maxReflectionSearches,
    targetVerifiedCount: deps.targetVerifiedCount,
    hitsPerSearch: HITS_PER_SEARCH,
    totalSearchBudget: deps.totalSearchBudget,
    onLog: deps.onLog,
    modelClient: deps.modelClient,
    chatModel: deps.chatModel,
    artistCache: deps.cache?.artists,
    onSearchAgain: () => deps.onProgress?.({ stage: "searchingAgain" }),
    onExtracted: (candidates) => lastFm?.prefetchInfo(candidates.map((c) => c.name)),
  });

  const graph = new StateGraph(RESEARCH_SCHEMA)
    .addNode("plan", async (state) => researchScope.run(20000, async (signal) => {
      const planWeb = await createWebSearchPlanner({
        timeoutMs: researchScope.allocate(20000),
        signal,
        modelClient: deps.modelClient,
        chatModel: deps.chatModel,
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
      deps.onProgress?.({ stage: "searching", anchorArtists: plan.anchorArtists });
      return { searchPlan: plan };
    }).catch((error: unknown) => {
      // Broad searches can still succeed when planning fails within its cap.
      log("warn", "research_plan_fallback", { reason: errorMessage(error) });
      return { searchPlan: fallbackSearchPlan(state.userQuery, state.obscurityTarget) };
    }))
    .addNode("lastfm_first", async (state) => {
      const anchors = state.searchPlan?.anchorArtists ?? [];
      if (!lastFm || anchors.length === 0 || !asksLastFmFirst(state.userQuery, state.obscurityTarget)) return {};
      const found = await lastFm.similarCandidates(anchors);
      if (found.length === 0 || researchScope.remaining() <= 0) return {};
      lastFm.prefetchInfo(found.map((c) => c.name));
      deps.onProgress?.({ stage: "checking", found: found.length });
      const verified = await verifyCandidatesWithMusicBrainz(mb, found, anchors, {
        shouldContinue: () => researchScope.remaining() > 0,
        cache: deps.cache?.artists,
      });
      const candidates = await lastFm.enrich(verified, anchors);
      const enough = enoughFromLastFm(withoutArtists(candidates, state.exclude), state.obscurityTarget);
      log("info", "research_lastfm_first", {
        found: found.length,
        verified: candidates.filter((c) => c.verified).length,
        fit: countTargetFit(candidates, state.obscurityTarget),
        enough,
      });
      // Not enough: the bands of the right size still join those of the web search.
      const kept = enough ? candidates : inRangeOnly(candidates, state.obscurityTarget).slice(0, MAX_KEPT_FROM_LASTFM);
      const names = new Set(kept.map((c) => c.name));
      if (!enough) deps.onProgress?.({ stage: "searching", anchorArtists: anchors });
      return {
        enoughFromLastFm: enough,
        verifiedCandidates: kept,
        extractedCandidates: found.filter((c) => names.has(c.name)),
      };
    })
    .addNode("brave_initial", async (state) => {
      const slice = state.searchPlan?.queries.slice(0, deps.maxInitialSearches) ?? [];
      const { hits, calls } = await runQueries(slice, deps.totalSearchBudget, HITS_PER_SEARCH);
      log("info", "research_brave_call", { phase: "initial", calls, hitCount: hits.length });
      return { braveHits: hits, searchCallsUsed: calls };
    })
    .addNode("extract", async (state) => researchScope.run(18000, async (signal) => {
      const extract = await createCandidateExtractor({
        timeoutMs: researchScope.allocate(18000),
        signal,
        modelClient: deps.modelClient,
        chatModel: deps.chatModel,
      });
      const anchors = state.searchPlan?.anchorArtists?.length ? state.searchPlan.anchorArtists : [];
      const hitsForExtract = Array.isArray(state.braveHits) ? state.braveHits.slice(0, maxExtractHits) : [];
      const fromWeb = await extract({ hits: hitsForExtract, anchorArtists: anchors });
      const candidates = mergeExtractedCandidates([...fromWeb, ...state.extractedCandidates]);
      log("info", "research_candidates_extracted", {
        count: candidates.length,
        fromWeb: fromWeb.length,
        fromLastFm: state.extractedCandidates.length,
      });
      lastFm?.prefetchInfo(candidates.map((c) => c.name));
      deps.onProgress?.({ stage: "checking", found: candidates.length });
      return { extractedCandidates: candidates };
    }).catch((error: unknown) => {
      if (researchScope.remaining() > 0) throw error;
      return {};
    }))
    .addNode("verify", async (state) => {
      const anchors = state.searchPlan?.anchorArtists ?? [];
      // Bands of the Last.fm round are verified already; what the web adds about them is merged in.
      const knownAs = (c: ExtractedCandidate) => findArtist(c, state.verifiedCandidates);
      const fresh = await verifyCandidatesWithMusicBrainz(
        mb,
        state.extractedCandidates.filter((c) => !knownAs(c)),
        anchors,
        { shouldContinue: () => researchScope.remaining() > 0, cache: deps.cache?.artists },
      );
      const again = state.extractedCandidates.flatMap((c) => {
        const earlier = knownAs(c);
        return earlier ? [{ ...earlier, ...c, name: earlier.name }] : [];
      });
      const verified = mergeVerifiedCandidates([...again, ...fresh]);
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
    .addNode("rank", async (state) => {
      // How long ranking took and whether it needed the evidence retry, which shares the cap (#369).
      const started = Date.now();
      let attempts = 0;
      try {
        return await budget.run(RANKING_RESERVE_MS, async (signal) => {
          const ranker = await createRecommendationRanker({
            timeoutMs: budget.allocate(RANKING_RESERVE_MS),
            signal,
            modelClient: deps.modelClient,
            chatModel: deps.chatModel,
          });
          const fresh = withoutArtists(state.verifiedCandidates, state.exclude);
          const filteredCandidates = filterCandidatesByObscurity(fresh, state.obscurityTarget);
          log("info", "research_obscurity_filter", {
            obscurityTarget: state.obscurityTarget ?? "none",
            before: fresh.length,
            after: filteredCandidates.length,
            // Shows whether in-range bands were found and filtered or ranked away, or never found (#325).
            fitBefore: countTargetFit(fresh, state.obscurityTarget),
            fitAfter: countTargetFit(filteredCandidates, state.obscurityTarget),
          });
          deps.onProgress?.({ stage: "choosing", candidates: filteredCandidates.length });
          const { recommendations, assistantReply } = await ranker({
            query: state.userQuery,
            preferenceContext: state.preferenceContext,
            messages: state.messages,
            mode: state.mode,
            candidates: filteredCandidates,
            obscurityTarget: state.obscurityTarget,
            onReply: deps.onReply,
            onAttempt: () => { attempts++; },
          });
          log("info", "research_ranked", {
            finalCount: Array.isArray(recommendations) ? recommendations.length : 0,
            durationMs: Date.now() - started,
            attempts,
          });
          return { recommendations, assistantReply };
        });
      } catch (error) {
        log("warn", "research_rank_failed", { durationMs: Date.now() - started, attempts, reason: errorMessage(error) });
        throw error;
      }
    })
    .addEdge(START, "plan")
    .addConditionalEdges("plan", ...untilCutoff("lastfm_first"))
    .addConditionalEdges(
      "lastfm_first",
      (state) => (state.enoughFromLastFm || researchScope.remaining() <= 0 ? "rank" : "brave_initial"),
      ["brave_initial", "rank"],
    )
    .addConditionalEdges("brave_initial", ...untilCutoff("extract"))
    .addConditionalEdges("extract", ...untilCutoff("verify"))
    .addConditionalEdges("verify", ...untilCutoff("reflect_if_needed"))
    .addConditionalEdges("reflect_if_needed", ...untilCutoff("enrich_lastfm"))
    .addEdge("enrich_lastfm", "rank")
    .addEdge("rank", END);

  return graph.compile();
}

/** The candidates that may not be any of the excluded artists. */
function withoutArtists(candidates: VerifiedCandidate[], excluded: readonly ArtistRef[] | undefined): VerifiedCandidate[] {
  if (!excluded?.length) return candidates;
  return candidates.filter((c) => !excluded.some((e) => mayBeSameArtist(e, c)));
}

/** The candidates of the requested size; all of them when there is no size to tell by. */
function inRangeOnly(candidates: VerifiedCandidate[], target: string | undefined): VerifiedCandidate[] {
  const fits = fitObscurityTarget(candidates.map((c) => c.listenerCount), target);
  return fits ? candidates.filter((_, i) => fits[i]!.fit === "inRange") : candidates;
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
  recommendations: Recommendation[];
  assistantReply: string;
  /** Every candidate found, with its evidence: what a follow-up can pick from. */
  candidates: VerifiedCandidate[];
  pipelineDiagnostics: PipelineDiagnostics;
  /** The model that wrote the ranker's prose — the run's provenance. */
  model: string;
}> {
  deps.signal?.throwIfAborted();
  const budget = createResearchBudget(deps.researchTimeoutMs);
  const stop = () => budget.close();
  deps.signal?.addEventListener("abort", stop, { once: true });
  deps.onProgress?.({ stage: "thinking" });
  try {
    const graph = await buildResearchGraph(deps, budget);
    const result = await budget.run(budget.remaining(), (signal) => graph.invoke({
      userQuery: input.userQuery,
      preferenceContext: input.preferenceContext,
      messages: input.messages,
      mode: input.mode,
      obscurityTarget: input.obscurityTarget,
      exclude: input.exclude,
      enoughFromLastFm: false,
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
      model: deps.model,
    };
  } finally {
    deps.signal?.removeEventListener("abort", stop);
    budget.close();
  }
}

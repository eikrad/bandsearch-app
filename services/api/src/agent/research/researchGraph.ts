import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import type { ChatMessage, RecommendationMode } from "../../../../../shared/schemas/src/contracts.js";
import { createBraveSearchClient } from "../../integrations/braveSearch.js";
import { createMusicBrainzClient } from "../../integrations/musicbrainz.js";
import { createCandidateExtractor, type SearchHitInput } from "./candidateExtractor.js";
import { verifyCandidatesWithMusicBrainz, type VerifiedCandidate } from "./candidateVerifier.js";
import { createRecommendationRanker } from "./recommendationRanker.js";
import { buildReflectionSubgraph } from "./reflectionSubgraph.js";
import { createResearchBudget, type ResearchBudget } from "./researchBudget.js";
import { createWebSearchPlanner, type SearchPlan } from "./webSearchPlanner.js";

export type ResearchGraphDeps = {
  geminiApiKey: string;
  braveApiKey: string;
  maxInitialSearches: number;
  maxReflectionSearches: number;
  totalSearchBudget: number;
  targetVerifiedCount: number;
  researchTimeoutMs: number;
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
};

export type ResearchGraphState = {
  userQuery: string;
  preferenceContext: string;
  messages: ChatMessage[];
  mode: RecommendationMode;
  searchPlan?: SearchPlan;
  braveHits: SearchHitInput[];
  searchCallsUsed: number;
  extractedCandidates: import("./candidateExtractor.js").ExtractedCandidate[];
  verifiedCandidates: VerifiedCandidate[];
  reflectionUsed: boolean;
  recommendations: unknown[];
  assistantReply: string;
};

const ResearchAnnotation = Annotation.Root({
  userQuery: Annotation<string>(),
  preferenceContext: Annotation<string>(),
  messages: Annotation<ChatMessage[]>(),
  mode: Annotation<RecommendationMode>(),
  searchPlan: Annotation<SearchPlan | undefined>(),
  braveHits: Annotation<SearchHitInput[]>(),
  searchCallsUsed: Annotation<number>(),
  extractedCandidates: Annotation<import("./candidateExtractor.js").ExtractedCandidate[]>(),
  verifiedCandidates: Annotation<VerifiedCandidate[]>(),
  reflectionUsed: Annotation<boolean>(),
  recommendations: Annotation<unknown[]>(),
  assistantReply: Annotation<string>(),
});

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

  const graph = new StateGraph(ResearchAnnotation)
    .addNode("plan", async (state) => {
      const planWeb = await createWebSearchPlanner({
        apiKey: deps.geminiApiKey,
        timeoutMs: budget.allocate(8000),
      });
      const plan = await planWeb({
        userQuery: state.userQuery,
        preferenceContext: state.preferenceContext,
        messages: state.messages,
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
        timeoutMs: budget.allocate(12000),
      });
      const anchors = state.searchPlan?.anchorArtists?.length ? state.searchPlan.anchorArtists : [];
      const candidates = await extract({ hits: state.braveHits, anchorArtists: anchors });
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .addNode("reflect_if_needed", reflectionSubgraph as any)
    .addNode("rank", async (state) => {
      const ranker = await createRecommendationRanker({
        apiKey: deps.geminiApiKey,
        timeoutMs: budget.allocate(12000),
      });
      const { recommendations, assistantReply } = await ranker({
        query: state.userQuery,
        preferenceContext: state.preferenceContext,
        messages: state.messages,
        mode: state.mode,
        candidates: state.verifiedCandidates,
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
    .addEdge("reflect_if_needed", "rank")
    .addEdge("rank", END);

  return graph.compile();
}

export async function invokeResearchGraph(
  deps: ResearchGraphDeps,
  input: ResearchGraphInput,
): Promise<{ recommendations: unknown[]; assistantReply: string }> {
  const budget = createResearchBudget(deps.researchTimeoutMs);
  const graph = await buildResearchGraph(deps, budget);
  const result = await graph.invoke({
    userQuery: input.userQuery,
    preferenceContext: input.preferenceContext,
    messages: input.messages,
    mode: input.mode,
    braveHits: [],
    searchCallsUsed: 0,
    extractedCandidates: [],
    verifiedCandidates: [],
    reflectionUsed: false,
    recommendations: [],
    assistantReply: "",
  });

  return {
    recommendations: Array.isArray(result.recommendations) ? result.recommendations : [],
    assistantReply: typeof result.assistantReply === "string" ? result.assistantReply : "",
  };
}

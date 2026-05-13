import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import type { ChatMessage, RecommendationMode } from "../../../../../shared/schemas/src/contracts.js";
import { createBraveSearchClient } from "../../integrations/braveSearch.js";
import { createMusicBrainzClient } from "../../integrations/musicbrainz.js";
import { createCandidateExtractor, type SearchHitInput } from "./candidateExtractor.js";
import {
  verifyCandidatesWithMusicBrainz,
  type VerifiedCandidate,
} from "./candidateVerifier.js";
import { createRecommendationRanker } from "./recommendationRanker.js";
import { createRecommendationReflector } from "./recommendationReflector.js";
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

/** Exported for tests — same logic as the conditional edge after `verify`. */
export function shouldRouteToRankAfterVerify(
  verifiedCandidates: VerifiedCandidate[],
  reflectionUsed: boolean,
  searchCallsUsed: number,
  deps: Pick<ResearchGraphDeps, "targetVerifiedCount" | "totalSearchBudget">,
): boolean {
  const verifiedOk = verifiedCandidates.filter((c) => c.verified).length;
  return (
    verifiedOk >= deps.targetVerifiedCount
    || reflectionUsed
    || searchCallsUsed >= deps.totalSearchBudget
  );
}

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

async function runBraveQueries(
  brave: ReturnType<typeof createBraveSearchClient>,
  queries: string[],
  budgetLeft: number,
  perQueryCount: number,
): Promise<{ hits: SearchHitInput[]; calls: number }> {
  const hits: SearchHitInput[] = [];
  let calls = 0;
  for (const q of queries) {
    if (calls >= budgetLeft) break;
    const res = await brave.search(q, { count: perQueryCount });
    calls += 1;
    for (const r of res.results) {
      hits.push({
        sourceQuery: q,
        title: r.title,
        url: r.url,
        description: r.description,
      });
    }
  }
  return { hits, calls };
}

export async function buildResearchGraph(deps: ResearchGraphDeps) {
  const log = deps.onLog ?? (() => {});

  const planWeb = await createWebSearchPlanner({
    apiKey: deps.geminiApiKey,
    timeoutMs: Math.min(8000, deps.researchTimeoutMs),
  });
  const extract = await createCandidateExtractor({
    apiKey: deps.geminiApiKey,
    timeoutMs: Math.min(12000, deps.researchTimeoutMs),
  });
  const reflector = await createRecommendationReflector({
    apiKey: deps.geminiApiKey,
    timeoutMs: Math.min(6000, deps.researchTimeoutMs),
    maxExtraQueries: deps.maxReflectionSearches,
  });
  const ranker = await createRecommendationRanker({
    apiKey: deps.geminiApiKey,
    timeoutMs: Math.min(12000, deps.researchTimeoutMs),
  });

  const mb = createMusicBrainzClient({
    timeoutMs: deps.musicBrainzTimeoutMs ?? 5000,
    retries: deps.musicBrainzRetries ?? 1,
  });

  const graph = new StateGraph(ResearchAnnotation)
    .addNode("plan", async (state) => {
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
      const dedup = new Map<string, { results: Array<{ title: string; url: string; description: string }> }>();
      const brave = createBraveSearchClient({
        apiKey: deps.braveApiKey,
        timeoutMs: 10000,
        retries: 1,
        dedupCache: dedup,
      });
      const slice = state.searchPlan?.queries.slice(0, deps.maxInitialSearches) ?? [];
      const { hits, calls } = await runBraveQueries(brave, slice, deps.totalSearchBudget, 8);
      log("info", "research_brave_call", {
        phase: "initial",
        calls,
        hitCount: hits.length,
      });
      return {
        braveHits: hits,
        searchCallsUsed: calls,
      };
    })
    .addNode("extract", async (state) => {
      const anchors = state.searchPlan?.anchorArtists?.length
        ? state.searchPlan.anchorArtists
        : [];
      const candidates = await extract({
        hits: state.braveHits,
        anchorArtists: anchors,
      });
      log("info", "research_candidates_extracted", { count: candidates.length });
      return { extractedCandidates: candidates };
    })
    .addNode("verify", async (state) => {
      const anchors = state.searchPlan?.anchorArtists ?? [];
      const verified = await verifyCandidatesWithMusicBrainz(mb, state.extractedCandidates, anchors);
      const verifiedCount = verified.filter((v) => v.verified).length;
      log("info", "research_verification_done", {
        verified: verifiedCount,
        total: verified.length,
      });
      return { verifiedCandidates: verified };
    })
    .addNode("reflect", async (state) => {
      const budgetLeft = deps.totalSearchBudget - state.searchCallsUsed;
      const reflection = await reflector({
        userQuery: state.userQuery,
        plan: state.searchPlan ?? { anchorArtists: [], styleSignals: [], mustHave: [], avoid: [], queries: [] },
        verifiedCandidates: state.verifiedCandidates,
        targetVerifiedCount: deps.targetVerifiedCount,
        searchBudgetRemaining: budgetLeft,
      });
      const extra = reflection.sufficient ? [] : reflection.extraQueries.slice(0, deps.maxReflectionSearches);
      log("info", "research_reflection_fired", {
        sufficient: reflection.sufficient,
        extraQueries: extra.length,
        gaps: reflection.gaps,
      });

      if (extra.length === 0 || budgetLeft <= 0) {
        return { reflectionUsed: true };
      }

      const dedup = new Map<string, { results: Array<{ title: string; url: string; description: string }> }>();
      const brave = createBraveSearchClient({
        apiKey: deps.braveApiKey,
        timeoutMs: 10000,
        retries: 1,
        dedupCache: dedup,
      });
      const { hits: newHits, calls } = await runBraveQueries(brave, extra, budgetLeft, 8);
      const merged = [...state.braveHits, ...newHits];
      log("info", "research_brave_call", {
        phase: "reflection",
        calls,
        hitCount: newHits.length,
      });
      return {
        braveHits: merged,
        searchCallsUsed: state.searchCallsUsed + calls,
        reflectionUsed: true,
      };
    })
    .addNode("extract_after_reflect", async (state) => {
      const anchors = state.searchPlan?.anchorArtists?.length
        ? state.searchPlan.anchorArtists
        : [];
      const candidates = await extract({
        hits: state.braveHits,
        anchorArtists: anchors,
      });
      return { extractedCandidates: candidates };
    })
    .addNode("verify_after_reflect", async (state) => {
      const anchors = state.searchPlan?.anchorArtists ?? [];
      const verified = await verifyCandidatesWithMusicBrainz(mb, state.extractedCandidates, anchors);
      return { verifiedCandidates: verified };
    })
    .addNode("rank", async (state) => {
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
      return {
        recommendations,
        assistantReply,
      };
    })
    .addEdge(START, "plan")
    .addEdge("plan", "brave_initial")
    .addEdge("brave_initial", "extract")
    .addEdge("extract", "verify")
    .addConditionalEdges(
      "verify",
      (s) =>
        shouldRouteToRankAfterVerify(
          s.verifiedCandidates,
          s.reflectionUsed,
          s.searchCallsUsed,
          deps,
        )
          ? "rank"
          : "reflect",
      {
        reflect: "reflect",
        rank: "rank",
      },
    )
    .addEdge("reflect", "extract_after_reflect")
    .addEdge("extract_after_reflect", "verify_after_reflect")
    .addEdge("verify_after_reflect", "rank")
    .addEdge("rank", END);

  return graph.compile();
}

export async function invokeResearchGraph(
  deps: ResearchGraphDeps,
  input: ResearchGraphInput,
): Promise<{ recommendations: unknown[]; assistantReply: string }> {
  const graph = await buildResearchGraph(deps);
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

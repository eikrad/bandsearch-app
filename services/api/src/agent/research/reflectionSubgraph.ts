import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import { createCandidateExtractor, type ExtractedCandidate, type SearchHitInput } from "./candidateExtractor.js";
import { verifyCandidatesWithMusicBrainz, type MusicBrainzVerifyClient, type VerifiedCandidate } from "./candidateVerifier.js";
import { createRecommendationReflector } from "./recommendationReflector.js";
import type { ResearchBudget } from "./researchBudget.js";
import type { SearchPlan } from "./webSearchPlanner.js";

export type ReflectionSubgraphDeps = {
  geminiApiKey: string;
  mb: MusicBrainzVerifyClient;
  runQueries: (
    queries: string[],
    budgetLeft: number,
    perQueryCount: number,
  ) => Promise<{ hits: SearchHitInput[]; calls: number }>;
  budget: ResearchBudget;
  maxRounds: number;
  maxReflectionSearches: number;
  targetVerifiedCount: number;
  totalSearchBudget: number;
  onLog?: (level: "info" | "warn", event: string, details: Record<string, unknown>) => void;
};

const ReflectionAnnotation = Annotation.Root({
  braveHits: Annotation<SearchHitInput[]>(),
  verifiedCandidates: Annotation<VerifiedCandidate[]>(),
  extractedCandidates: Annotation<ExtractedCandidate[]>(),
  searchCallsUsed: Annotation<number>(),
  searchPlan: Annotation<SearchPlan | undefined>(),
  userQuery: Annotation<string>(),
  reflectionUsed: Annotation<boolean>(),
  roundsCompleted: Annotation<number>(),
  nextExtraQueries: Annotation<string[]>(),
});

export function buildReflectionSubgraph(deps: ReflectionSubgraphDeps) {
  const log = deps.onLog ?? (() => {});

  return new StateGraph(ReflectionAnnotation)
    .addNode("assess", async (state) => {
      const reflector = await createRecommendationReflector({
        apiKey: deps.geminiApiKey,
        timeoutMs: deps.budget.allocate(6000),
        maxExtraQueries: deps.maxReflectionSearches,
      });
      const budgetLeft = deps.totalSearchBudget - state.searchCallsUsed;
      const reflection = await reflector({
        userQuery: state.userQuery,
        plan: state.searchPlan ?? { anchorArtists: [], styleSignals: [], mustHave: [], avoid: [], queries: [] },
        verifiedCandidates: state.verifiedCandidates,
        targetVerifiedCount: deps.targetVerifiedCount,
        searchBudgetRemaining: budgetLeft,
      });
      const extraQueries = reflection.sufficient
        ? []
        : reflection.extraQueries.slice(0, deps.maxReflectionSearches);
      log("info", "research_reflection_assess", {
        round: (state.roundsCompleted ?? 0) + 1,
        sufficient: reflection.sufficient,
        extraQueries: extraQueries.length,
        gaps: reflection.gaps,
      });
      return { reflectionUsed: true, nextExtraQueries: extraQueries };
    })
    .addNode("search", async (state) => {
      const budgetLeft = deps.totalSearchBudget - state.searchCallsUsed;
      const { hits: newHits, calls } = await deps.runQueries(
        state.nextExtraQueries ?? [],
        budgetLeft,
        8,
      );
      log("info", "research_brave_call", {
        phase: "reflection",
        round: (state.roundsCompleted ?? 0) + 1,
        calls,
        hitCount: newHits.length,
      });
      return {
        braveHits: [...state.braveHits, ...newHits],
        searchCallsUsed: state.searchCallsUsed + calls,
      };
    })
    .addNode("extract_r", async (state) => {
      const extract = await createCandidateExtractor({
        apiKey: deps.geminiApiKey,
        timeoutMs: deps.budget.allocate(12000),
      });
      const anchors = state.searchPlan?.anchorArtists?.length ? state.searchPlan.anchorArtists : [];
      const candidates = await extract({ hits: state.braveHits, anchorArtists: anchors });
      return { extractedCandidates: candidates };
    })
    .addNode("verify_r", async (state) => {
      const anchors = state.searchPlan?.anchorArtists ?? [];
      const verified = await verifyCandidatesWithMusicBrainz(deps.mb, state.extractedCandidates, anchors);
      const verifiedCount = verified.filter((v) => v.verified).length;
      const round = (state.roundsCompleted ?? 0) + 1;
      log("info", "research_verification_done", {
        phase: "reflection",
        round,
        verified: verifiedCount,
        total: verified.length,
      });
      return { verifiedCandidates: verified, roundsCompleted: round };
    })
    .addEdge(START, "assess")
    .addConditionalEdges("assess", (state) =>
      (state.nextExtraQueries?.length ?? 0) === 0 || deps.budget.remaining() <= 0 ? END : "search",
    )
    .addEdge("search", "extract_r")
    .addEdge("extract_r", "verify_r")
    .addConditionalEdges("verify_r", (state) =>
      (state.roundsCompleted ?? 0) >= deps.maxRounds || deps.budget.remaining() <= 0 ? END : "assess",
    )
    .compile();
}

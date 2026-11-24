import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import * as z from "zod";

import { type ExtractedCandidate, type SearchHitInput } from "./candidateExtractor.js";
import { type MusicBrainzVerifyClient, type VerifiedCandidate } from "./candidateVerifier.js";
import { runCandidatePoolRound } from "./candidatePoolRound.js";
import { createRecommendationReflector } from "./recommendationReflector.js";
import { errorMessage, type ChatModelClient } from "../modelUtils.js";
import type { ResearchBudget } from "./researchBudget.js";
import type { ResearchCache } from "./researchCache.js";
import type { SearchPlan } from "./webSearchPlanner.js";
import type { ChatModelFactory } from "../../llm/chatModel.js";

export type ReflectionSubgraphDeps = {
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
  hitsPerSearch: number;
  totalSearchBudget: number;
  onLog?: (level: "info" | "warn", event: string, details: Record<string, unknown>) => void;
  /** A ready chat model for the assess and extract nodes; tests pass one. */
  modelClient?: ChatModelClient;
  /** Builds the assess and extract nodes' models from the configured provider. */
  chatModel?: ChatModelFactory;
  artistCache?: ResearchCache["artists"];
  /** Told when another round of searching starts. */
  onSearchAgain?: () => void;
  /** Told the names a round found, before they are verified. */
  onExtracted?: (candidates: ExtractedCandidate[]) => void;
};

export const REFLECTION_SCHEMA = new StateSchema({
  braveHits: z.custom<SearchHitInput[]>(),
  newHits: z.custom<SearchHitInput[]>(),
  verifiedCandidates: z.custom<VerifiedCandidate[]>(),
  extractedCandidates: z.custom<ExtractedCandidate[]>(),
  searchCallsUsed: z.number(),
  searchPlan: z.custom<SearchPlan | undefined>(),
  userQuery: z.string(),
  reflectionUsed: z.boolean(),
  roundsCompleted: z.number(),
  nextExtraQueries: z.array(z.string()),
});

/**
 * The time a reflection round needs (search, extract, verify) before another
 * one may start. Unmeasured estimate; whether it fits the research budget is
 * #180.
 */
export const MIN_REFLECTION_CYCLE_MS = 25_000;

export function buildReflectionSubgraph(deps: ReflectionSubgraphDeps) {
  const log = deps.onLog ?? (() => {});

  /** Checked before each round, the first included; logs when it says no. */
  function hasTimeForAnotherCycle(): boolean {
    const remaining = deps.budget.remaining();
    if (remaining >= MIN_REFLECTION_CYCLE_MS) return true;
    log("warn", "research_reflection_skipped_budget", { remaining, threshold: MIN_REFLECTION_CYCLE_MS });
    return false;
  }

  return new StateGraph(REFLECTION_SCHEMA)
    .addNode("assess", async (state) => {
      const verifiedCount = state.verifiedCandidates.filter((candidate) => candidate.verified).length;
      if (verifiedCount >= deps.targetVerifiedCount) {
        return { nextExtraQueries: [], reflectionUsed: state.reflectionUsed };
      }
      if (deps.budget.remaining() <= 0) return { nextExtraQueries: [], reflectionUsed: true };
      return deps.budget.run(6000, async (signal) => {
        const reflector = await createRecommendationReflector({
          timeoutMs: deps.budget.allocate(6000),
          signal,
          maxExtraQueries: deps.maxReflectionSearches,
          modelClient: deps.modelClient,
          chatModel: deps.chatModel,
        });
        const budgetLeft = deps.totalSearchBudget - state.searchCallsUsed;
        const reflection = await reflector({
          userQuery: state.userQuery,
          plan: state.searchPlan ?? { anchorArtists: [], styleSignals: [], mustHave: [], avoid: [], queries: [] },
          verifiedCandidates: state.verifiedCandidates,
          targetVerifiedCount: deps.targetVerifiedCount,
          searchBudgetRemaining: budgetLeft,
        });
        // The pool size is a search rule. The model can describe gaps and
        // suggest queries, but cannot waive the verified-candidate target.
        const extraQueries = budgetLeft <= 0
          ? []
          : reflection.extraQueries.slice(0, deps.maxReflectionSearches);
        log("info", "research_reflection_assess", {
          round: (state.roundsCompleted ?? 0) + 1,
          sufficient: verifiedCount >= deps.targetVerifiedCount || budgetLeft <= 0,
          modelSufficient: reflection.sufficient,
          verifiedCount,
          targetVerifiedCount: deps.targetVerifiedCount,
          extraQueries: extraQueries.length,
          gaps: reflection.gaps,
        });
        return { reflectionUsed: true, nextExtraQueries: extraQueries };
      }).catch((error: unknown) => {
        log("warn", "research_reflection_skipped", { reason: errorMessage(error) });
        return { nextExtraQueries: [] };
      });
    })
    .addNode("search", async (state) => {
      deps.onSearchAgain?.();
      const budgetLeft = deps.totalSearchBudget - state.searchCallsUsed;
      const { hits: newHits, calls } = await deps.runQueries(
        state.nextExtraQueries ?? [],
        budgetLeft,
        deps.hitsPerSearch,
      );
      log("info", "research_brave_call", {
        phase: "reflection",
        round: (state.roundsCompleted ?? 0) + 1,
        calls,
        hitCount: newHits.length,
      });
      return {
        braveHits: [...state.braveHits, ...newHits],
        newHits,
        searchCallsUsed: state.searchCallsUsed + calls,
      };
    })
    .addNode("candidate_round", async (state) => {
      const anchors = state.searchPlan?.anchorArtists ?? [];
      const round = (state.roundsCompleted ?? 0) + 1;
      const result = await runCandidatePoolRound({
        mb: deps.mb,
        budget: deps.budget,
        modelClient: deps.modelClient,
        chatModel: deps.chatModel,
        artistCache: deps.artistCache,
        onLog: deps.onLog,
        onExtracted: deps.onExtracted,
      }, {
        hits: state.newHits ?? [],
        anchorArtists: anchors,
        extractedCandidates: state.extractedCandidates,
        verifiedCandidates: state.verifiedCandidates,
        round: round + 1,
        phase: "reflection",
      });
      return { ...result, roundsCompleted: round };
    })
    .addEdge(START, "assess")
    .addConditionalEdges("assess", (state) => {
      if ((state.nextExtraQueries?.length ?? 0) === 0) return END;
      return hasTimeForAnotherCycle() ? "search" : END;
    })
    .addEdge("search", "candidate_round")
    .addConditionalEdges("candidate_round", (state) => {
      if ((state.roundsCompleted ?? 0) >= deps.maxRounds) return END;
      return hasTimeForAnotherCycle() ? "assess" : END;
    })
    .compile();
}

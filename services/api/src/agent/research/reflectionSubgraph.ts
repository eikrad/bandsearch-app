import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import * as z from "zod";

import { createCandidateExtractor, mergeExtractedCandidates, type ExtractedCandidate, type SearchHitInput } from "./candidateExtractor.js";
import { mergeVerifiedCandidates, verifyCandidatesWithMusicBrainz, type MusicBrainzVerifyClient, type VerifiedCandidate } from "./candidateVerifier.js";
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
      if (deps.budget.remaining() <= 0) return { nextExtraQueries: [] };
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
    .addNode("extract_r", async (state) => {
      if (deps.budget.remaining() <= 0) return {};
      return deps.budget.run(12000, async (signal) => {
        const extract = await createCandidateExtractor({
          timeoutMs: deps.budget.allocate(12000),
          signal,
          modelClient: deps.modelClient,
          chatModel: deps.chatModel,
        });
        const anchors = state.searchPlan?.anchorArtists?.length ? state.searchPlan.anchorArtists : [];
        const fresh = await extract({ hits: state.newHits ?? [], anchorArtists: anchors });
        deps.onExtracted?.(fresh);
        return { extractedCandidates: mergeExtractedCandidates([...state.extractedCandidates, ...fresh]) };
      }).catch((error: unknown) => {
        log("warn", "research_reflection_extract_failed", { reason: errorMessage(error) });
        return {};
      });
    })
    .addNode("verify_r", async (state) => {
      const anchors = state.searchPlan?.anchorArtists ?? [];
      const seen = new Set<string>();
      for (const v of state.verifiedCandidates) {
        seen.add(v.name.toLowerCase());
        if (v.canonicalName) seen.add(v.canonicalName.toLowerCase());
      }
      const toVerify = state.extractedCandidates.filter((c) => !seen.has(c.name.toLowerCase()));
      const fresh = toVerify.length > 0
        ? await verifyCandidatesWithMusicBrainz(deps.mb, toVerify, anchors, {
            shouldContinue: () => deps.budget.remaining() > 0,
            cache: deps.artistCache,
          })
        : [];
      const merged = mergeVerifiedCandidates([...state.verifiedCandidates, ...fresh]);
      const round = (state.roundsCompleted ?? 0) + 1;
      log("info", "research_verification_done", {
        phase: "reflection",
        round,
        verified: merged.filter((v) => v.verified).length,
        total: merged.length,
        newlyVerified: fresh.length,
      });
      return { verifiedCandidates: merged, roundsCompleted: round };
    })
    .addEdge(START, "assess")
    .addConditionalEdges("assess", (state) => {
      if ((state.nextExtraQueries?.length ?? 0) === 0) return END;
      return hasTimeForAnotherCycle() ? "search" : END;
    })
    .addEdge("search", "extract_r")
    .addEdge("extract_r", "verify_r")
    .addConditionalEdges("verify_r", (state) => {
      if ((state.roundsCompleted ?? 0) >= deps.maxRounds) return END;
      return hasTimeForAnotherCycle() ? "assess" : END;
    })
    .compile();
}

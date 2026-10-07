import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import * as z from "zod";

import { createCandidateExtractor, mergeExtractedCandidates, type ExtractedCandidate, type SearchHitInput } from "./candidateExtractor.js";
import { mergeVerifiedCandidates, verifyCandidatesWithMusicBrainz, type MusicBrainzVerifyClient, type VerifiedCandidate } from "./candidateVerifier.js";
import { createRecommendationReflector } from "./recommendationReflector.js";
import { errorMessage, type ChatModelClient } from "../modelUtils.js";
import type { ResearchBudget } from "./researchBudget.js";
import type { SearchPlan } from "./webSearchPlanner.js";
import type { ChatModelFactory } from "../../llm/chatModel.js";

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
  /** Chat model for the assess and extract nodes; defaults to Gemini from `geminiApiKey`. */
  modelClient?: ChatModelClient;
  /** Builds the assess and extract nodes' models from the configured provider. */
  chatModel?: ChatModelFactory;
  /** Model id for the assess and extract nodes; defaults to `DEFAULT_RESEARCH_MODEL`. */
  model?: string;
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

export function buildReflectionSubgraph(deps: ReflectionSubgraphDeps) {
  const log = deps.onLog ?? (() => {});

  return new StateGraph(REFLECTION_SCHEMA)
    .addNode("assess", async (state) => {
      const reflector = await createRecommendationReflector({
        apiKey: deps.geminiApiKey,
        timeoutMs: deps.budget.allocate(6000),
        maxExtraQueries: deps.maxReflectionSearches,
        modelClient: deps.modelClient,
        chatModel: deps.chatModel,
        model: deps.model,
      });
      const budgetLeft = deps.totalSearchBudget - state.searchCallsUsed;
      let reflection;
      try {
        reflection = await reflector({
          userQuery: state.userQuery,
          plan: state.searchPlan ?? { anchorArtists: [], styleSignals: [], mustHave: [], avoid: [], queries: [] },
          verifiedCandidates: state.verifiedCandidates,
          targetVerifiedCount: deps.targetVerifiedCount,
          searchBudgetRemaining: budgetLeft,
        });
      } catch (error) {
        // Reflection only adds searches; without it the run keeps what it found.
        log("warn", "research_reflection_skipped", { reason: errorMessage(error) });
        return { nextExtraQueries: [] };
      }
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
        newHits,
        searchCallsUsed: state.searchCallsUsed + calls,
      };
    })
    .addNode("extract_r", async (state) => {
      const extract = await createCandidateExtractor({
        apiKey: deps.geminiApiKey,
        timeoutMs: deps.budget.allocate(12000),
        modelClient: deps.modelClient,
        chatModel: deps.chatModel,
        model: deps.model,
      });
      const anchors = state.searchPlan?.anchorArtists?.length ? state.searchPlan.anchorArtists : [];
      try {
        const fresh = await extract({ hits: state.newHits ?? [], anchorArtists: anchors });
        return { extractedCandidates: mergeExtractedCandidates([...state.extractedCandidates, ...fresh]) };
      } catch (error) {
        // The candidates from the first round are still good; keep them.
        log("warn", "research_reflection_extract_failed", { reason: errorMessage(error) });
        return {};
      }
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
        ? await verifyCandidatesWithMusicBrainz(deps.mb, toVerify, anchors)
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
      const MIN_REFLECTION_CYCLE_MS = 25_000;
      if (deps.budget.remaining() < MIN_REFLECTION_CYCLE_MS) {
        log("warn", "research_reflection_skipped_budget", {
          remaining: deps.budget.remaining(),
          threshold: MIN_REFLECTION_CYCLE_MS,
        });
        return END;
      }
      return "search";
    })
    .addEdge("search", "extract_r")
    .addEdge("extract_r", "verify_r")
    .addConditionalEdges("verify_r", (state) => {
      if ((state.roundsCompleted ?? 0) >= deps.maxRounds) return END;
      const MIN_REFLECTION_CYCLE_MS = 25_000;
      if (deps.budget.remaining() < MIN_REFLECTION_CYCLE_MS) {
        log("warn", "research_reflection_skipped_budget", {
          remaining: deps.budget.remaining(),
          threshold: MIN_REFLECTION_CYCLE_MS,
        });
        return END;
      }
      return "assess";
    })
    .compile();
}

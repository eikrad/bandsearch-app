import { findArtist } from "../../../../../shared/schemas/src/artistIdentity.js";
import { createCandidateExtractor, mergeExtractedCandidates, type ExtractedCandidate, type SearchHitInput } from "./candidateExtractor.js";
import { mergeVerifiedCandidates, verifyCandidatesWithMusicBrainz, type MusicBrainzVerifyClient, type VerifiedCandidate } from "./candidateVerifier.js";
import type { ResearchBudget } from "./researchBudget.js";
import type { ResearchCache } from "./researchCache.js";
import { errorMessage, type ChatModelClient } from "../modelUtils.js";
import type { ChatModelFactory } from "../../llm/chatModel.js";

export type CandidatePoolRoundDeps = {
  mb: MusicBrainzVerifyClient;
  budget: ResearchBudget;
  modelClient?: ChatModelClient;
  chatModel?: ChatModelFactory;
  artistCache?: ResearchCache["artists"];
  onLog?: (level: "info" | "warn", event: string, details: Record<string, unknown>) => void;
  onExtracted?: (candidates: ExtractedCandidate[]) => void;
};

export type CandidatePoolRoundInput = {
  hits: SearchHitInput[];
  anchorArtists: string[];
  extractedCandidates: ExtractedCandidate[];
  verifiedCandidates: VerifiedCandidate[];
  round: number;
  phase: "initial" | "reflection";
};

/** Runs the candidate decisions shared by the first and every later search round. */
export async function runCandidatePoolRound(
  deps: CandidatePoolRoundDeps,
  input: CandidatePoolRoundInput,
): Promise<{ extractedCandidates: ExtractedCandidate[]; verifiedCandidates: VerifiedCandidate[] }> {
  const log = deps.onLog ?? (() => {});
  let fresh: ExtractedCandidate[] = [];

  if (input.hits.length > 0 && deps.budget.remaining() > 0) {
    const extractorBudgetMs = input.phase === "initial" ? 18000 : 12000;
    try {
      fresh = await deps.budget.run(extractorBudgetMs, async (signal) => {
        const extract = await createCandidateExtractor({
          timeoutMs: deps.budget.allocate(extractorBudgetMs),
          signal,
          modelClient: deps.modelClient,
          chatModel: deps.chatModel,
        });
        return extract({ hits: input.hits, anchorArtists: input.anchorArtists });
      });
      deps.onExtracted?.(fresh);
    } catch (error) {
      if (input.phase === "initial" && deps.budget.remaining() > 0) throw error;
      log("warn", input.phase === "reflection" ? "research_reflection_extract_failed" : "research_candidate_extract_skipped", {
        reason: errorMessage(error),
      });
    }
  }

  const extractedCandidates = mergeExtractedCandidates([...input.extractedCandidates, ...fresh]);
  log("info", "research_candidates_extracted", {
    count: extractedCandidates.length,
    fromWeb: fresh.length,
    fromPrevious: input.extractedCandidates.length,
    round: input.round,
    phase: input.phase,
  });
  const alreadyVerified = (candidate: ExtractedCandidate) => findArtist(candidate, input.verifiedCandidates);
  const toVerify = extractedCandidates.filter((candidate) => !alreadyVerified(candidate));
  const newlyVerified = toVerify.length > 0
    ? await verifyCandidatesWithMusicBrainz(deps.mb, toVerify, input.anchorArtists, {
        shouldContinue: () => deps.budget.remaining() > 0,
        cache: deps.artistCache,
      })
    : [];
  const existingWithEvidence = extractedCandidates.flatMap((candidate) => {
    const previous = alreadyVerified(candidate);
    return previous ? [{ ...previous, ...candidate, name: previous.name }] : [];
  });
  const verifiedCandidates = mergeVerifiedCandidates([
    ...input.verifiedCandidates,
    ...existingWithEvidence,
    ...newlyVerified,
  ]);

  log("info", "research_verification_done", {
    phase: input.phase,
    round: input.round,
    extracted: extractedCandidates.length,
    verified: verifiedCandidates.filter((candidate) => candidate.verified).length,
    total: verifiedCandidates.length,
    newlyVerified: newlyVerified.length,
  });

  return { extractedCandidates, verifiedCandidates };
}

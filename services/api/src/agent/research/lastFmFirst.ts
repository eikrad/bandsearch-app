import { validateObscurityTarget } from "../../../../../shared/schemas/src/contracts.js";
import { fitObscurityTarget } from "../../obscurityTargets.js";
import type { VerifiedCandidate } from "./candidateVerifier.js";

/** Bands of the requested size that make a web search unnecessary: a choice for the ranker, and some for a follow-up. */
export const ENOUGH_IN_RANGE = 8;
/** Without a target there is no range to be in; then this many verified bands are a choice. */
export const ENOUGH_VERIFIED = 12;

/**
 * Whether to ask Last.fm before the web at all. The smallest acts are too small
 * for its similar-artist lists: of 40 bands, 0–7 had at most 5,000 listeners
 * (golden set, 2026-11-22; Underground 8–31, Cult Following 31–38).
 */
export function asksLastFmFirst(obscurityTarget: string | undefined): boolean {
  return validateObscurityTarget(obscurityTarget) !== "obscure";
}

/**
 * Whether the bands Last.fm's listeners file next to the anchors are enough to
 * answer from. Last.fm knows the neighbours of known artists well and the
 * smallest acts hardly, so it is enough only with bands of the requested size;
 * which those are is the obscurity filter's own rule.
 */
export function enoughFromLastFm(candidates: VerifiedCandidate[], obscurityTarget: string | undefined): boolean {
  const verified = candidates.filter((c) => c.verified);
  if (!validateObscurityTarget(obscurityTarget)) return verified.length >= ENOUGH_VERIFIED;
  // Only bands Last.fm has a count for: a missing one says the lookup failed, since Last.fm named the band.
  const counted = verified.filter((c) => c.listenerCount != null);
  return (fitObscurityTarget(counted.map((c) => c.listenerCount), obscurityTarget) ?? [])
    .filter(({ fit }) => fit === "inRange").length >= ENOUGH_IN_RANGE;
}

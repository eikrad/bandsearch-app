import { validateObscurityTarget, type ObscurityTarget } from "../../../shared/schemas/src/contracts.js";

/**
 * The Last.fm listener range each obscurity target asks for, both ends
 * included (#325). This is the one definition of what a target means; the
 * ranges overlap on purpose, matching the judge-calibration labels.
 *
 * Not the same as the tier cut points in `eval/obscurityScorer.ts`: those sort
 * every band into exactly one tier for the distribution chart.
 */
export const OBSCURITY_TARGET_RANGES: Readonly<Record<ObscurityTarget, { min: number; max: number }>> = {
  cult: { min: 20_000, max: 500_000 },
  underground: { min: 2_000, max: 50_000 },
  obscure: { min: 0, max: 5_000 },
};

export type ObscurityTargetFit = "inRange" | "tooObscure" | "tooMainstream";

function hasCount(listeners: number | null | undefined): listeners is number {
  return typeof listeners === "number" && Number.isFinite(listeners) && listeners >= 0;
}

/**
 * How far a listener count misses the target's range, as a log ratio: missing a
 * 20k floor by 5k is closer than missing it by 19k. 0 inside the range.
 */
function rangeMiss(listeners: number, target: ObscurityTarget): number {
  const { min, max } = OBSCURITY_TARGET_RANGES[target];
  if (listeners < min) return Math.log(min / Math.max(listeners, 1));
  if (listeners > max) return Math.log(listeners / max);
  return 0;
}

export type TargetFit = { fit: ObscurityTargetFit; miss: number };

/**
 * Fits the bands of one request against its obscurity target. The search's
 * filter and the eval both decide by this, so they cannot drift apart (#325):
 *
 * - A band below the range misses it as much as one above it.
 * - A band Last.fm has no count for counts as obscure (0 listeners): no
 *   Last.fm page almost always means a tiny audience.
 * - When no band has a count (Last.fm off or down), there is nothing to fit
 *   against: null, as it is without a recognised target.
 */
export function fitObscurityTarget(
  listeners: ReadonlyArray<number | null | undefined>,
  target: string | null | undefined,
): TargetFit[] | null {
  const known = validateObscurityTarget(target);
  if (!known || !listeners.some(hasCount)) return null;
  return listeners.map((l) => {
    const count = hasCount(l) ? l : 0;
    const miss = rangeMiss(count, known);
    const { min } = OBSCURITY_TARGET_RANGES[known];
    const fit: ObscurityTargetFit = miss === 0 ? "inRange" : count < min ? "tooObscure" : "tooMainstream";
    return { fit, miss };
  });
}

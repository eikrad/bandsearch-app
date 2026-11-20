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

export type ObscurityTargetFit = "inRange" | "tooObscure" | "tooMainstream" | "unknown";

/**
 * Where a band's listener count falls against the requested target. Missing the
 * range downwards is as much a miss as missing it upwards. Returns null when no
 * recognised target was requested, so there is nothing to fit.
 */
export function obscurityTargetFit(
  listeners: number | null | undefined,
  target: string | null | undefined,
): ObscurityTargetFit | null {
  const known = validateObscurityTarget(target);
  if (!known) return null;
  if (typeof listeners !== "number" || !Number.isFinite(listeners) || listeners < 0) return "unknown";
  const { min, max } = OBSCURITY_TARGET_RANGES[known];
  if (listeners < min) return "tooObscure";
  if (listeners > max) return "tooMainstream";
  return "inRange";
}

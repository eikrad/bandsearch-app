import type { RecommendationEvent, BandEvalScore } from "./evalRepository.js";
import type { ObscurityTarget } from "../../../../shared/schemas/src/contracts.js";
import { obscurityTargetFit } from "../obscurityTargets.js";

export type TargetFitCounts = { inRange: number; tooObscure: number; tooMainstream: number; unknown: number };

export type AggregatedMetrics = {
  eventCount: number;
  bandCount: number;
  meanRelevance: number | null;
  meanObscurityFit: number | null;
  meanEvidenceQuality: number | null;
  meanDiscoveryValue: number | null;
  obscurityDistribution: { mainstream: number; cult: number; underground: number; obscure: number; unknown: number };
  /** Bands per requested target, by where their listeners fall against its range (#325). */
  obscurityTargetFit: Record<ObscurityTarget, TargetFitCounts>;
  /** Share of bands with a listener count and a requested target that land inside its range. */
  obscurityInRangeRate: number | null;
  sourceQualityDistribution: { high: number; medium: number; low: number };
  meanCitationSupportRate: number | null;
  genericWhyRate: number | null;
};

export type MetricsDelta = {
  meanRelevance: number | null;
  meanObscurityFit: number | null;
  meanEvidenceQuality: number | null;
  meanDiscoveryValue: number | null;
  meanCitationSupportRate: number | null;
  genericWhyRate: number | null;
  obscurityInRangeRate: number | null;
};

/** Baselines saved before #325 carry no target-fit metrics. */
export type StoredMetrics = Omit<AggregatedMetrics, "obscurityTargetFit" | "obscurityInRangeRate"> &
  Partial<Pick<AggregatedMetrics, "obscurityTargetFit" | "obscurityInRangeRate">>;

const noFit = (): TargetFitCounts => ({ inRange: 0, tooObscure: 0, tooMainstream: 0, unknown: 0 });

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function nullableDiff(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return a - b;
}

export function aggregateMetrics(
  events: RecommendationEvent[],
  bandScores: BandEvalScore[],
): AggregatedMetrics {
  const obscurityDistribution = { mainstream: 0, cult: 0, underground: 0, obscure: 0, unknown: 0 };
  const sourceQualityDistribution = { high: 0, medium: 0, low: 0 };
  const targetFit: Record<ObscurityTarget, TargetFitCounts> = { cult: noFit(), underground: noFit(), obscure: noFit() };
  const targetOf = new Map(events.map((e) => [e.id, e.obscurityTarget]));

  const relevances: number[] = [];
  const obscurityFits: number[] = [];
  const evidenceQualities: number[] = [];
  const discoveryValues: number[] = [];
  const citationRates: number[] = [];
  let genericWhyCount = 0;
  let genericWhyTotal = 0;

  for (const score of bandScores) {
    if (
      score.obscurityTier === "mainstream" ||
      score.obscurityTier === "cult" ||
      score.obscurityTier === "underground" ||
      score.obscurityTier === "obscure" ||
      score.obscurityTier === "unknown"
    ) {
      obscurityDistribution[score.obscurityTier]++;
    }
    const target = targetOf.get(score.eventId);
    const fit = obscurityTargetFit(score.listeners, target);
    if (fit) targetFit[target as ObscurityTarget][fit]++;
    if (score.sourceQuality === "high" || score.sourceQuality === "medium" || score.sourceQuality === "low") {
      sourceQualityDistribution[score.sourceQuality]++;
    }
    if (score.relevance != null) relevances.push(score.relevance);
    if (score.obscurityFit != null) obscurityFits.push(score.obscurityFit);
    if (score.evidenceQuality != null) evidenceQualities.push(score.evidenceQuality);
    if (score.discoveryValue != null) discoveryValues.push(score.discoveryValue);
    if (score.citationSupportRate != null) citationRates.push(score.citationSupportRate);
    if (score.genericWhyFlag != null) {
      genericWhyTotal++;
      if (score.genericWhyFlag) genericWhyCount++;
    }
  }

  const fits = Object.values(targetFit);
  const inRange = fits.reduce((n, f) => n + f.inRange, 0);
  const decided = fits.reduce((n, f) => n + f.inRange + f.tooObscure + f.tooMainstream, 0);

  return {
    eventCount: events.length,
    bandCount: bandScores.length,
    meanRelevance: mean(relevances),
    meanObscurityFit: mean(obscurityFits),
    meanEvidenceQuality: mean(evidenceQualities),
    meanDiscoveryValue: mean(discoveryValues),
    obscurityDistribution,
    obscurityTargetFit: targetFit,
    obscurityInRangeRate: decided > 0 ? inRange / decided : null,
    sourceQualityDistribution,
    meanCitationSupportRate: mean(citationRates),
    genericWhyRate: genericWhyTotal > 0 ? genericWhyCount / genericWhyTotal : null,
  };
}

export function computeDelta(
  current: AggregatedMetrics,
  baseline: StoredMetrics,
): MetricsDelta {
  return {
    meanRelevance: nullableDiff(current.meanRelevance, baseline.meanRelevance),
    meanObscurityFit: nullableDiff(current.meanObscurityFit, baseline.meanObscurityFit),
    meanEvidenceQuality: nullableDiff(current.meanEvidenceQuality, baseline.meanEvidenceQuality),
    meanDiscoveryValue: nullableDiff(current.meanDiscoveryValue, baseline.meanDiscoveryValue),
    meanCitationSupportRate: nullableDiff(current.meanCitationSupportRate, baseline.meanCitationSupportRate),
    genericWhyRate: nullableDiff(current.genericWhyRate, baseline.genericWhyRate),
    obscurityInRangeRate: nullableDiff(current.obscurityInRangeRate, baseline.obscurityInRangeRate ?? null),
  };
}

import type { RecommendationEvent, BandEvalScore } from "./evalRepository.js";
import type { ObscurityTarget } from "../../../../shared/schemas/src/contracts.js";
import { fitObscurityTarget } from "../obscurityTargets.js";

export type TargetFitCounts = { inRange: number; tooObscure: number; tooMainstream: number };

export type AggregatedMetrics = {
  eventCount: number;
  bandCount: number;
  meanRelevance: number | null;
  meanObscurityFit: number | null;
  meanEvidenceQuality: number | null;
  meanDiscoveryValue: number | null;
  obscurityDistribution: { mainstream: number; cult: number; underground: number; obscure: number; unknown: number };
  /**
   * Bands per requested target, by where their listeners fall against its range,
   * fitted per request by the same rule the research filter uses (#325).
   */
  obscurityTargetFit: Record<ObscurityTarget, TargetFitCounts>;
  /** Share of fitted bands that land inside their request's target range. */
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

const noFit = (): TargetFitCounts => ({ inRange: 0, tooObscure: 0, tooMainstream: 0 });

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

  // Fitted per request, like the filter: a band without a count only counts as
  // obscure when Last.fm had counts for that request at all.
  for (const event of events) {
    const listeners = bandScores.filter((s) => s.eventId === event.id).map((s) => s.listeners);
    const fits = fitObscurityTarget(listeners, event.obscurityTarget);
    if (fits) for (const { fit } of fits) targetFit[event.obscurityTarget as ObscurityTarget][fit]++;
  }
  const counts = Object.values(targetFit);
  const inRange = counts.reduce((n, f) => n + f.inRange, 0);
  const decided = counts.reduce((n, f) => n + f.inRange + f.tooObscure + f.tooMainstream, 0);

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

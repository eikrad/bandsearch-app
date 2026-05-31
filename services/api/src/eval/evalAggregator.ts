import type { RecommendationEvent, BandEvalScore } from "./evalRepository.js";

export type AggregatedMetrics = {
  eventCount: number;
  bandCount: number;
  meanRelevance: number | null;
  meanObscurityFit: number | null;
  meanEvidenceQuality: number | null;
  meanDiscoveryValue: number | null;
  obscurityDistribution: { cult: number; underground: number; obscure: number };
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
};

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
  const obscurityDistribution = { cult: 0, underground: 0, obscure: 0 };
  const sourceQualityDistribution = { high: 0, medium: 0, low: 0 };

  const relevances: number[] = [];
  const obscurityFits: number[] = [];
  const evidenceQualities: number[] = [];
  const discoveryValues: number[] = [];
  const citationRates: number[] = [];
  let genericWhyCount = 0;
  let genericWhyTotal = 0;

  for (const score of bandScores) {
    if (score.obscurityTier === "cult" || score.obscurityTier === "underground" || score.obscurityTier === "obscure") {
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

  return {
    eventCount: events.length,
    bandCount: bandScores.length,
    meanRelevance: mean(relevances),
    meanObscurityFit: mean(obscurityFits),
    meanEvidenceQuality: mean(evidenceQualities),
    meanDiscoveryValue: mean(discoveryValues),
    obscurityDistribution,
    sourceQualityDistribution,
    meanCitationSupportRate: mean(citationRates),
    genericWhyRate: genericWhyTotal > 0 ? genericWhyCount / genericWhyTotal : null,
  };
}

export function computeDelta(
  current: AggregatedMetrics,
  baseline: AggregatedMetrics,
): MetricsDelta {
  return {
    meanRelevance: nullableDiff(current.meanRelevance, baseline.meanRelevance),
    meanObscurityFit: nullableDiff(current.meanObscurityFit, baseline.meanObscurityFit),
    meanEvidenceQuality: nullableDiff(current.meanEvidenceQuality, baseline.meanEvidenceQuality),
    meanDiscoveryValue: nullableDiff(current.meanDiscoveryValue, baseline.meanDiscoveryValue),
    meanCitationSupportRate: nullableDiff(current.meanCitationSupportRate, baseline.meanCitationSupportRate),
    genericWhyRate: nullableDiff(current.genericWhyRate, baseline.genericWhyRate),
  };
}

import test from "node:test";
import assert from "node:assert/strict";
import { aggregateMetrics, computeDelta } from "../../src/eval/evalAggregator.js";

const sampleDiagnostics = {
  braveHitCount: 5,
  extractedCandidateCount: 3,
  verifiedCount: 2,
  reflectionTriggered: false,
  searchBudgetUsed: 3,
};

function makeEvent(overrides = {}) {
  return {
    id: "evt-1",
    query: "dark ambient",
    mode: "fresh",
    obscurityTarget: "obscure",
    pipelineVersion: "0.4.0",
    pipelineDiagnostics: sampleDiagnostics,
    recommendationCount: 2,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeScore(overrides = {}) {
  return {
    eventId: "evt-1",
    bandName: "Lustmord",
    listeners: 30000,
    obscurityTier: "cult",
    sourceQuality: "high",
    citationSupportRate: 0.8,
    genericWhyFlag: false,
    relevance: 0.9,
    obscurityFit: 0.7,
    evidenceQuality: 0.8,
    discoveryValue: 0.85,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test("aggregateMetrics: returns eventCount=0 for empty input", () => {
  const result = aggregateMetrics([], []);
  assert.equal(result.eventCount, 0);
  assert.equal(result.bandCount, 0);
});

test("aggregateMetrics: counts events and bands correctly", () => {
  const events = [makeEvent({ id: "e1" }), makeEvent({ id: "e2" })];
  const scores = [
    makeScore({ eventId: "e1", bandName: "A" }),
    makeScore({ eventId: "e1", bandName: "B" }),
    makeScore({ eventId: "e2", bandName: "C" }),
  ];
  const result = aggregateMetrics(events, scores);
  assert.equal(result.eventCount, 2);
  assert.equal(result.bandCount, 3);
});

test("aggregateMetrics: computes mean judge scores across all bands", () => {
  const events = [makeEvent({ id: "e1" })];
  const scores = [
    makeScore({ eventId: "e1", bandName: "A", relevance: 0.8, obscurityFit: 0.6, evidenceQuality: 0.7, discoveryValue: 0.9 }),
    makeScore({ eventId: "e1", bandName: "B", relevance: 0.4, obscurityFit: 1.0, evidenceQuality: 0.5, discoveryValue: 0.3 }),
  ];
  const result = aggregateMetrics(events, scores);
  assert.ok(Math.abs(result.meanRelevance - 0.6) < 0.001);
  assert.ok(Math.abs(result.meanObscurityFit - 0.8) < 0.001);
  assert.ok(Math.abs(result.meanEvidenceQuality - 0.6) < 0.001);
  assert.ok(Math.abs(result.meanDiscoveryValue - 0.6) < 0.001);
});

test("aggregateMetrics: mean scores are null when no judge data exists", () => {
  const events = [makeEvent({ id: "e1" })];
  const scores = [
    makeScore({ eventId: "e1", bandName: "A", relevance: undefined, obscurityFit: undefined, evidenceQuality: undefined, discoveryValue: undefined }),
  ];
  const result = aggregateMetrics(events, scores);
  assert.equal(result.meanRelevance, null);
  assert.equal(result.meanObscurityFit, null);
});

test("aggregateMetrics: obscurity tier distribution counts correctly", () => {
  const events = [makeEvent({ id: "e1" })];
  const scores = [
    makeScore({ eventId: "e1", bandName: "A", obscurityTier: "cult" }),
    makeScore({ eventId: "e1", bandName: "B", obscurityTier: "obscure" }),
    makeScore({ eventId: "e1", bandName: "C", obscurityTier: "cult" }),
    makeScore({ eventId: "e1", bandName: "D", obscurityTier: "underground" }),
  ];
  const result = aggregateMetrics(events, scores);
  assert.equal(result.obscurityDistribution.cult, 2);
  assert.equal(result.obscurityDistribution.underground, 1);
  assert.equal(result.obscurityDistribution.obscure, 1);
});

test("aggregateMetrics: obscurity distribution counts mainstream and unknown (F4)", () => {
  const events = [makeEvent({ id: "e1" })];
  const scores = [
    makeScore({ eventId: "e1", bandName: "A", obscurityTier: "mainstream" }),
    makeScore({ eventId: "e1", bandName: "B", obscurityTier: "mainstream" }),
    makeScore({ eventId: "e1", bandName: "C", obscurityTier: "unknown" }),
    makeScore({ eventId: "e1", bandName: "D", obscurityTier: "obscure" }),
  ];
  const result = aggregateMetrics(events, scores);
  assert.equal(result.obscurityDistribution.mainstream, 2, "mainstream bands must be visible");
  assert.equal(result.obscurityDistribution.unknown, 1, "unknown (not on Last.fm) tracked as its own bucket");
  assert.equal(result.obscurityDistribution.obscure, 1);
  assert.equal(result.obscurityDistribution.cult, 0);
});

test("aggregateMetrics: source quality distribution counts correctly", () => {
  const events = [makeEvent({ id: "e1" })];
  const scores = [
    makeScore({ eventId: "e1", bandName: "A", sourceQuality: "high" }),
    makeScore({ eventId: "e1", bandName: "B", sourceQuality: "low" }),
    makeScore({ eventId: "e1", bandName: "C", sourceQuality: "high" }),
  ];
  const result = aggregateMetrics(events, scores);
  assert.equal(result.sourceQualityDistribution.high, 2);
  assert.equal(result.sourceQualityDistribution.medium, 0);
  assert.equal(result.sourceQualityDistribution.low, 1);
});

test("aggregateMetrics: meanCitationSupportRate computed correctly", () => {
  const events = [makeEvent({ id: "e1" })];
  const scores = [
    makeScore({ eventId: "e1", bandName: "A", citationSupportRate: 0.5 }),
    makeScore({ eventId: "e1", bandName: "B", citationSupportRate: 1.0 }),
  ];
  const result = aggregateMetrics(events, scores);
  assert.ok(Math.abs(result.meanCitationSupportRate - 0.75) < 0.001);
});

test("aggregateMetrics: genericWhyRate = proportion of bands with flag set", () => {
  const events = [makeEvent({ id: "e1" })];
  const scores = [
    makeScore({ eventId: "e1", bandName: "A", genericWhyFlag: true }),
    makeScore({ eventId: "e1", bandName: "B", genericWhyFlag: false }),
    makeScore({ eventId: "e1", bandName: "C", genericWhyFlag: true }),
    makeScore({ eventId: "e1", bandName: "D", genericWhyFlag: false }),
  ];
  const result = aggregateMetrics(events, scores);
  assert.ok(Math.abs(result.genericWhyRate - 0.5) < 0.001);
});

test("computeDelta: returns correct difference between two metrics", () => {
  const current = {
    eventCount: 10,
    bandCount: 40,
    meanRelevance: 0.8,
    meanObscurityFit: 0.7,
    meanEvidenceQuality: 0.6,
    meanDiscoveryValue: 0.75,
    obscurityDistribution: { mainstream: 0, cult: 10, underground: 20, obscure: 10, unknown: 0 },
    sourceQualityDistribution: { high: 30, medium: 5, low: 5 },
    meanCitationSupportRate: 0.9,
    genericWhyRate: 0.1,
  };
  const baseline = {
    eventCount: 5,
    bandCount: 20,
    meanRelevance: 0.7,
    meanObscurityFit: 0.6,
    meanEvidenceQuality: 0.5,
    meanDiscoveryValue: 0.65,
    obscurityDistribution: { mainstream: 0, cult: 5, underground: 10, obscure: 5, unknown: 0 },
    sourceQualityDistribution: { high: 15, medium: 3, low: 2 },
    meanCitationSupportRate: 0.8,
    genericWhyRate: 0.2,
  };
  const delta = computeDelta(current, baseline);
  assert.ok(Math.abs(delta.meanRelevance - 0.1) < 0.001);
  assert.ok(Math.abs(delta.meanObscurityFit - 0.1) < 0.001);
  assert.ok(Math.abs(delta.meanEvidenceQuality - 0.1) < 0.001);
  assert.ok(Math.abs(delta.meanDiscoveryValue - 0.1) < 0.001);
  assert.ok(Math.abs(delta.meanCitationSupportRate - 0.1) < 0.001);
  assert.ok(Math.abs(delta.genericWhyRate - (-0.1)) < 0.001);
});

test("computeDelta: returns null for dimensions where either value is null", () => {
  const current = {
    eventCount: 5,
    bandCount: 10,
    meanRelevance: null,
    meanObscurityFit: 0.7,
    meanEvidenceQuality: null,
    meanDiscoveryValue: 0.5,
    obscurityDistribution: { mainstream: 0, cult: 0, underground: 0, obscure: 0, unknown: 0 },
    sourceQualityDistribution: { high: 0, medium: 0, low: 0 },
    meanCitationSupportRate: null,
    genericWhyRate: 0.3,
  };
  const baseline = {
    eventCount: 5,
    bandCount: 10,
    meanRelevance: 0.6,
    meanObscurityFit: null,
    meanEvidenceQuality: 0.4,
    meanDiscoveryValue: 0.5,
    obscurityDistribution: { mainstream: 0, cult: 0, underground: 0, obscure: 0, unknown: 0 },
    sourceQualityDistribution: { high: 0, medium: 0, low: 0 },
    meanCitationSupportRate: 0.8,
    genericWhyRate: 0.3,
  };
  const delta = computeDelta(current, baseline);
  assert.equal(delta.meanRelevance, null);
  assert.equal(delta.meanObscurityFit, null);
  assert.equal(delta.meanEvidenceQuality, null);
  assert.equal(delta.meanCitationSupportRate, null);
  assert.ok(Math.abs(delta.meanDiscoveryValue - 0) < 0.001);
});

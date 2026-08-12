import test from "node:test";
import assert from "node:assert/strict";
import { computeAgreementRate, runUnitTests, type UnitTestCase } from "../../src/eval/judgeCalibration.js";

const humanLabels = [
  {
    bandName: "Band A",
    humanScores: { relevance: 0.9, obscurityFit: 0.8, evidenceQuality: 0.7 },
  },
  {
    bandName: "Band B",
    humanScores: { relevance: 0.3, obscurityFit: 0.2, evidenceQuality: 0.4 },
  },
  {
    bandName: "Band C",
    humanScores: { relevance: 0.8, obscurityFit: 0.6, evidenceQuality: 0.9 },
  },
];

test("computeAgreementRate: 100% when judge directions match human directions exactly", () => {
  const judgeScores = [
    { bandName: "Band A", relevance: 0.85, obscurityFit: 0.75, evidenceQuality: 0.65 },
    { bandName: "Band B", relevance: 0.25, obscurityFit: 0.15, evidenceQuality: 0.35 },
    { bandName: "Band C", relevance: 0.95, obscurityFit: 0.55, evidenceQuality: 0.88 },
  ];
  const result = computeAgreementRate(humanLabels, judgeScores);
  assert.equal(result.rate, 1.0);
  assert.equal(result.perDimension.relevance, 1.0);
  assert.equal(result.perDimension.obscurityFit, 1.0);
  assert.equal(result.perDimension.evidenceQuality, 1.0);
});

test("computeAgreementRate: 0% when judge directions are fully inverted from human", () => {
  const judgeScores = [
    { bandName: "Band A", relevance: 0.1, obscurityFit: 0.2, evidenceQuality: 0.3 },
    { bandName: "Band B", relevance: 0.9, obscurityFit: 0.8, evidenceQuality: 0.7 },
    { bandName: "Band C", relevance: 0.1, obscurityFit: 0.2, evidenceQuality: 0.1 },
  ];
  const result = computeAgreementRate(humanLabels, judgeScores);
  assert.equal(result.rate, 0.0);
  assert.equal(result.perDimension.relevance, 0.0);
  assert.equal(result.perDimension.obscurityFit, 0.0);
  assert.equal(result.perDimension.evidenceQuality, 0.0);
});

test("computeAgreementRate: partial agreement counts correctly", () => {
  // Band A: judge agrees on relevance (0.85 vs 0.9 both high), disagrees on obscurityFit (0.1 vs 0.8)
  // Band B: judge agrees on all (both low)
  // Only Band A and B used; Band C not in judgeScores
  const judgeScores = [
    { bandName: "Band A", relevance: 0.85, obscurityFit: 0.1, evidenceQuality: 0.65 },
    { bandName: "Band B", relevance: 0.2, obscurityFit: 0.15, evidenceQuality: 0.35 },
  ];
  const result = computeAgreementRate(humanLabels, judgeScores);
  // relevance: Band A agree (both >=0.5), Band B agree (both <0.5) → 2/2 = 1.0
  // obscurityFit: Band A disagree (0.1 < 0.5, human 0.8 >= 0.5), Band B agree (both <0.5) → 1/2 = 0.5
  // evidenceQuality: Band A agree (both >=0.5... 0.65 >= 0.5, 0.7 >= 0.5), Band B agree → 2/2 = 1.0
  assert.equal(result.perDimension.relevance, 1.0);
  assert.equal(result.perDimension.obscurityFit, 0.5);
  assert.equal(result.perDimension.evidenceQuality, 1.0);
  // overall: (1.0 + 0.5 + 1.0) / 3 = 0.833...
  assert.ok(result.rate > 0.8 && result.rate < 0.9, `rate ${result.rate} should be ~0.833`);
});

test("computeAgreementRate: null judge score dimensions are skipped for that band", () => {
  const judgeScores = [
    { bandName: "Band A", relevance: null, obscurityFit: 0.75, evidenceQuality: 0.65 },
    { bandName: "Band B", relevance: 0.25, obscurityFit: 0.15, evidenceQuality: 0.35 },
  ];
  const result = computeAgreementRate(humanLabels, judgeScores);
  // relevance: only Band B matched → 1/1 = 1.0
  assert.equal(result.perDimension.relevance, 1.0);
  // obscurityFit: Band A agrees, Band B agrees → 2/2 = 1.0
  assert.equal(result.perDimension.obscurityFit, 1.0);
  assert.equal(result.perDimension.evidenceQuality, 1.0);
});

test("computeAgreementRate: returns rate 0 with empty perDimension when no matching bands", () => {
  const judgeScores = [{ bandName: "Unknown Band", relevance: 0.5, obscurityFit: 0.5, evidenceQuality: 0.5 }];
  const result = computeAgreementRate(humanLabels, judgeScores);
  assert.equal(result.rate, 0);
});

test("computeAgreementRate: handles empty inputs gracefully", () => {
  const result = computeAgreementRate([], []);
  assert.equal(result.rate, 0);
  assert.equal(result.perDimension.relevance, 0);
  assert.equal(result.perDimension.obscurityFit, 0);
  assert.equal(result.perDimension.evidenceQuality, 0);
});

// --- runUnitTests ---

const unitTests: UnitTestCase[] = [
  {
    id: "ut-1",
    description: "high relevance band → relevance should be high",
    bandName: "BandAlpha",
    expectedDirection: { evidenceQuality: "high" },
  },
  {
    id: "ut-2",
    description: "mainstream band for obscure target → obscurityFit should be low",
    bandName: "BandBeta",
    expectedDirection: { obscurityFit: "low" },
  },
  {
    id: "ut-3",
    description: "specific cited why → evidenceQuality high",
    bandName: "BandGamma",
    expectedDirection: { evidenceQuality: "high", obscurityFit: "high" },
  },
];

test("runUnitTests: all pass when judge directions match expected directions", () => {
  const judgeScores = [
    { bandName: "BandAlpha", evidenceQuality: 0.8, obscurityFit: 0.7 },
    { bandName: "BandBeta", evidenceQuality: 0.7, obscurityFit: 0.2 },
    { bandName: "BandGamma", evidenceQuality: 0.9, obscurityFit: 0.8 },
  ];
  const result = runUnitTests(unitTests, judgeScores);
  assert.equal(result.passRate, 1.0);
  assert.equal(result.failures.length, 0);
});

test("runUnitTests: failure recorded when direction does not match expected", () => {
  const judgeScores = [
    { bandName: "BandAlpha", evidenceQuality: 0.3, obscurityFit: 0.7 }, // evidenceQuality wrong: 0.3 < 0.5 but expected "high"
    { bandName: "BandBeta", evidenceQuality: 0.7, obscurityFit: 0.2 },  // correct
    { bandName: "BandGamma", evidenceQuality: 0.9, obscurityFit: 0.2 }, // obscurityFit wrong: 0.2 < 0.5 but expected "high"
  ];
  const result = runUnitTests(unitTests, judgeScores);
  // ut-1: evidenceQuality 0.3 → "low" but expected "high" → fail
  // ut-2: obscurityFit 0.2 → "low" as expected → pass
  // ut-3: evidenceQuality 0.9 → "high" as expected, obscurityFit 0.2 → "low" but expected "high" → fail
  assert.equal(result.failures.length, 2);
  assert.ok(result.failures.some((f) => f.id === "ut-1"));
  assert.ok(result.failures.some((f) => f.id === "ut-3"));
  assert.ok(result.passRate > 0 && result.passRate < 1);
});

test("runUnitTests: missing judge score for band counts as failure for that test", () => {
  const judgeScores = [
    { bandName: "BandBeta", evidenceQuality: 0.7, obscurityFit: 0.2 },
  ];
  // BandAlpha and BandGamma have no judge scores → failures
  const result = runUnitTests(unitTests, judgeScores);
  assert.ok(result.failures.some((f) => f.id === "ut-1"), "ut-1 should fail (no score)");
  assert.ok(result.failures.some((f) => f.id === "ut-3"), "ut-3 should fail (no score)");
});

test("runUnitTests: empty test list returns passRate 1.0 and no failures", () => {
  const result = runUnitTests([], []);
  assert.equal(result.passRate, 1.0);
  assert.equal(result.failures.length, 0);
});

test("runUnitTests: failure includes id, description, dimension, expected, actual", () => {
  const judgeScores = [
    { bandName: "BandAlpha", evidenceQuality: 0.1 },
  ];
  const result = runUnitTests([unitTests[0]], judgeScores);
  assert.equal(result.failures.length, 1);
  const failure = result.failures[0];
  assert.equal(failure.id, "ut-1");
  assert.ok(typeof failure.description === "string" && failure.description.length > 0);
  assert.ok(typeof failure.dimension === "string");
  assert.equal(failure.expected, "high");
  assert.ok(typeof failure.actual === "number" || failure.actual === null || failure.actual === undefined);
});

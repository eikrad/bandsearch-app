import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAntiBandRate, computeNuggetCoverage } from "./run-golden.ts";

// computePrecisionAtK and its tests were removed: it divided hits by the size of
// the reference set rather than by k, so it computed recall@k under a precision
// name — and it was called with the same `nuggets` list as computeNuggetCoverage,
// making the two functions return identical values. The cases below cover the
// surviving metric.

// ─── computeAntiBandRate ──────────────────────────────────────────────────────

test("computeAntiBandRate returns 0 when no anti-bands in results", () => {
  const antiBands = ["Imagine Dragons", "Coldplay"];
  const results = ["Alcest", "Fen", "Les Discrets"];
  assert.equal(computeAntiBandRate(antiBands, results, 8), 0);
});

test("computeAntiBandRate returns 1.0 when all top-k results are anti-bands", () => {
  const antiBands = ["Imagine Dragons", "Coldplay"];
  const results = ["Imagine Dragons", "Coldplay"];
  assert.equal(computeAntiBandRate(antiBands, results, 8), 1.0);
});

test("computeAntiBandRate returns partial rate", () => {
  const antiBands = ["Imagine Dragons"];
  const results = ["Imagine Dragons", "Alcest", "Fen", "Les Discrets"];
  assert.equal(computeAntiBandRate(antiBands, results, 4), 0.25);
});

test("computeAntiBandRate only considers top-k results", () => {
  const antiBands = ["Imagine Dragons"];
  const results = ["Alcest", "Fen", "Imagine Dragons"];
  // k=2: only Alcest and Fen — no anti-bands
  assert.equal(computeAntiBandRate(antiBands, results, 2), 0);
});

test("computeAntiBandRate returns 0 for empty results", () => {
  assert.equal(computeAntiBandRate(["Imagine Dragons"], [], 8), 0);
});

// ─── computeNuggetCoverage ────────────────────────────────────────────────────

test("computeNuggetCoverage returns 1.0 when all nuggets found", () => {
  const nuggets = ["Alcest", "Fen"];
  const results = ["Alcest", "Fen", "Les Discrets"];
  assert.equal(computeNuggetCoverage(nuggets, results, 8), 1.0);
});

test("computeNuggetCoverage returns 0 when no nuggets found", () => {
  const nuggets = ["Alcest", "Fen"];
  const results = ["Deafheaven", "Les Discrets"];
  assert.equal(computeNuggetCoverage(nuggets, results, 8), 0);
});

test("computeNuggetCoverage returns partial coverage", () => {
  const nuggets = ["Alcest", "Fen", "Les Discrets"];
  const results = ["Alcest", "Deafheaven", "Les Discrets"];
  // 2 of 3 nuggets found
  const actual = computeNuggetCoverage(nuggets, results, 8);
  assert.ok(Math.abs(actual - 2 / 3) < 0.001, `expected ~0.667 but got ${actual}`);
});

test("computeNuggetCoverage only considers top-k results", () => {
  const nuggets = ["Alcest"];
  const results = ["Deafheaven", "Fen", "Alcest"];
  // k=2: Alcest is not in top 2
  assert.equal(computeNuggetCoverage(nuggets, results, 2), 0);
});

test("computeNuggetCoverage returns 0 for empty results", () => {
  assert.equal(computeNuggetCoverage(["Alcest"], [], 8), 0);
});

test("computeNuggetCoverage returns 0 for empty nuggets", () => {
  assert.equal(computeNuggetCoverage([], ["Alcest"], 8), 0);
});

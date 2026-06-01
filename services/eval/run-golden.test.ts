import { test } from "node:test";
import assert from "node:assert/strict";
import { computePrecisionAtK, computeAntiBandRate, computeNuggetCoverage } from "./run-golden.ts";

// ─── computePrecisionAtK ──────────────────────────────────────────────────────

test("computePrecisionAtK returns 1.0 when all expected bands found in top-k", () => {
  const expected = ["Alcest", "Fen", "Les Discrets"];
  const results = ["Alcest", "Fen", "Les Discrets", "Deafheaven", "Bosse-de-Nage"];
  assert.equal(computePrecisionAtK(expected, results, 8), 1.0);
});

test("computePrecisionAtK returns 0 when no expected bands in top-k", () => {
  const expected = ["Alcest", "Fen"];
  const results = ["Deafheaven", "Bosse-de-Nage", "Wolves in the Throne Room"];
  assert.equal(computePrecisionAtK(expected, results, 8), 0);
});

test("computePrecisionAtK returns partial match ratio", () => {
  const expected = ["Alcest", "Fen", "Les Discrets", "Lantlôs"];
  const results = ["Alcest", "Fen", "Deafheaven", "Bosse-de-Nage"];
  assert.equal(computePrecisionAtK(expected, results, 8), 0.5);
});

test("computePrecisionAtK only looks at first k results", () => {
  const expected = ["Alcest"];
  const results = ["Deafheaven", "Fen", "Alcest", "Les Discrets"];
  // k=2: only looks at Deafheaven, Fen — Alcest is at index 2, outside k=2
  assert.equal(computePrecisionAtK(expected, results, 2), 0);
  // k=3: Alcest is in top 3
  assert.equal(computePrecisionAtK(expected, results, 3), 1.0);
});

test("computePrecisionAtK returns 0 for empty results", () => {
  assert.equal(computePrecisionAtK(["Alcest"], [], 8), 0);
});

test("computePrecisionAtK returns 0 for empty expected", () => {
  assert.equal(computePrecisionAtK([], ["Alcest"], 8), 0);
});

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

test("computeNuggetCoverage returns 0 for empty nuggets", () => {
  assert.equal(computeNuggetCoverage([], ["Alcest"], 8), 0);
});

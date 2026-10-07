import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendRun,
  buildGoldenRunRecord,
  goldenSetHashes,
  loadRuns,
  type GoldenRunRecord,
} from "./history.ts";
import type { GoldenEntry, GoldenResult } from "./run-golden.ts";

const entries: GoldenEntry[] = [
  { id: "blackgaze", query: "bands like Alcest", nuggets: ["blackgaze"], antiBands: ["Coldplay"] },
  { id: "dungeon-synth", query: "dungeon synth like Mortiis", nuggets: ["dungeon synth"] },
  { id: "zeuhl", query: "zeuhl like Magma", nuggets: ["zeuhl"] },
];

function result(overrides: Partial<GoldenResult> & Pick<GoldenResult, "id">): GoldenResult {
  return {
    query: "q",
    status: "pass",
    passed: true,
    resultNames: ["Fen", "Ghost Bath"],
    antiBandRateAt8: 0,
    nuggetCoverageAt8: 1,
    uncoveredNuggets: [],
    warnings: [],
    latencyMs: 1000,
    model: "gemini-2.5-flash",
    pipelineVersion: "0.4.0",
    replay: false,
    tagSources: { musicbrainz: 2, lastfm: 0, none: 0 },
    constraintRateAt8: null,
    constraintVerdicts: null,
    failedGates: [],
    judgeScores: null,
    ...overrides,
  };
}

function record(results: GoldenResult[]): GoldenRunRecord {
  return buildGoldenRunRecord({
    entries,
    results,
    startedAt: new Date("2026-10-05T10:15:00Z"),
    finishedAt: new Date("2026-10-05T10:45:30Z"),
    label: "baseline",
    notes: null,
    git: { commit: "abc1234", branch: "staging", dirty: false },
    apiUrl: "http://localhost:3001",
  });
}

// ─── run identity ─────────────────────────────────────────────────────────────

test("a golden run is identified by its UTC start time", () => {
  const run = record([result({ id: "blackgaze" })]);
  assert.equal(run.runId, "20261005_101500");
  assert.equal(run.timestamp, "2026-10-05T10:15:00.000Z");
  assert.equal(run.durationSec, 1830);
});

// ─── what was tested ──────────────────────────────────────────────────────────

test("a golden run records the model the API reported, not one the runner assumed", () => {
  const run = record([
    result({ id: "blackgaze", model: "gemma-4-26b-a4b-it" }),
    result({ id: "dungeon-synth", model: "gemma-4-26b-a4b-it" }),
  ]);
  assert.equal(run.config.researchModel, "gemma-4-26b-a4b-it");
  assert.equal(run.config.pipelineVersion, "0.4.0");
});

test("a golden run whose queries ran on different models says so", () => {
  const run = record([
    result({ id: "blackgaze", model: "model-a" }),
    result({ id: "dungeon-synth", model: "model-b" }),
  ]);
  assert.equal(run.config.researchModel, "mixed: model-a, model-b");
});

test("a golden run against an API that reports no model records none", () => {
  const run = record([result({ id: "blackgaze", model: null })]);
  assert.equal(run.config.researchModel, null);
});

// ─── what came out ────────────────────────────────────────────────────────────

test("a golden run keeps each query's top 8 so runs can be diffed per answer", () => {
  const names = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
  const run = record([result({ id: "blackgaze", resultNames: names })]);
  assert.deepEqual(run.results[0]!.top8, names.slice(0, 8));
});

test("runner errors stay out of the quality means but count in the error rate", () => {
  const run = record([
    result({ id: "blackgaze", nuggetCoverageAt8: 1, antiBandRateAt8: 0, latencyMs: 1000 }),
    result({ id: "dungeon-synth", status: "fail", passed: false, nuggetCoverageAt8: 0, antiBandRateAt8: 0.5, latencyMs: 3000 }),
    result({
      id: "zeuhl",
      status: "error",
      passed: false,
      nuggetCoverageAt8: 0,
      antiBandRateAt8: 0,
      latencyMs: null,
      model: null,
      error: "API error 502",
    }),
  ]);

  assert.equal(run.summary.passRate, 0.5, "pass rate over answered queries only");
  assert.equal(run.summary.nuggetCoverageMean, 0.5);
  assert.equal(run.summary.antiBandRateMean, 0.25);
  assert.equal(run.summary.errorRate, 1 / 3);
  assert.equal(run.summary.latencyMsMedian, 2000);
  assert.equal(run.summary.latencyMsMax, 3000);

  const errored = run.results.find((r) => r.id === "zeuhl")!;
  assert.equal(errored.status, "error");
  assert.equal(errored.metrics, null, "an errored query has no quality metrics, not zeros");
  assert.equal(errored.error, "API error 502");
});

test("a golden run where every query errored has no quality summary", () => {
  const run = record([result({ id: "blackgaze", status: "error", passed: false, latencyMs: null })]);
  assert.equal(run.summary.passRate, null);
  assert.equal(run.summary.nuggetCoverageMean, null);
  assert.equal(run.summary.errorRate, 1);
});

// ─── comparability ────────────────────────────────────────────────────────────

test("the question hash ignores grading targets; the content hash does not", () => {
  const base = goldenSetHashes(entries);
  const regraded = goldenSetHashes(
    entries.map((e) => (e.id === "zeuhl" ? { ...e, nuggets: ["zeuhl", "jazz fusion"] } : e)),
  );
  const requeried = goldenSetHashes(
    entries.map((e) => (e.id === "zeuhl" ? { ...e, query: "zeuhl like Univers Zero" } : e)),
  );

  assert.equal(regraded.questionsHash, base.questionsHash, "same questions stay comparable");
  assert.notEqual(regraded.contentHash, base.contentHash, "changed nuggets are visible");
  assert.notEqual(requeried.questionsHash, base.questionsHash, "a changed query is a different set");
});

test("the golden-set hashes do not depend on entry order", () => {
  assert.deepEqual(goldenSetHashes([...entries].reverse()), goldenSetHashes(entries));
});

// ─── storage ──────────────────────────────────────────────────────────────────

test("runs appended to the history read back in order", () => {
  const path = join(mkdtempSync(join(tmpdir(), "golden-history-")), "nested", "runs.jsonl");
  const first = record([result({ id: "blackgaze" })]);
  const second = { ...first, runId: "20261005_120000", label: "gemma" };

  appendRun(path, first);
  appendRun(path, second);

  assert.deepEqual(loadRuns(path).map((r) => r.runId), ["20261005_101500", "20261005_120000"]);
});

test("a missing history file reads as no runs", () => {
  assert.deepEqual(loadRuns(join(tmpdir(), "does-not-exist", "runs.jsonl")), []);
});

test("a history with a damaged line names the line instead of skipping it", () => {
  const path = join(mkdtempSync(join(tmpdir(), "golden-history-")), "runs.jsonl");
  writeFileSync(path, `${JSON.stringify(record([result({ id: "blackgaze" })]))}\n{not json\n`);
  assert.throws(() => loadRuns(path), /line 2/);
});

test("queries with unknown coverage stay out of the coverage mean", () => {
  const run = record([
    result({ id: "blackgaze", nuggetCoverageAt8: 1 }),
    result({ id: "dungeon-synth", nuggetCoverageAt8: null }),
    result({ id: "zeuhl", nuggetCoverageAt8: 0.5 }),
  ]);

  assert.equal(run.summary.nuggetCoverageMean, 0.75);
  assert.equal(run.results[1]!.metrics?.nuggetCoverageAt8, null);
});

test("a golden run reports how many bands the API returned per query", () => {
  const run = record([
    result({ id: "blackgaze", resultNames: ["A", "B", "C"] }),
    result({ id: "dungeon-synth", resultNames: ["A", "B", "C", "D", "E", "F", "G", "H", "I"] }),
  ]);
  assert.equal(run.summary.resultCountMean, 6, "counts what the API returned, not only the top 8");
});

test("a golden run records whether the API replayed recorded lookups", () => {
  assert.equal(record([result({ id: "blackgaze", replay: true })]).config.replay, true);
  assert.equal(record([result({ id: "blackgaze", replay: false })]).config.replay, false);
  assert.equal(
    record([result({ id: "blackgaze", replay: true }), result({ id: "zeuhl", replay: false })]).config.replay,
    "mixed",
  );
});

test("a golden run keeps each query's tag sources and is scored under metrics version 2", () => {
  const run = record([result({ id: "blackgaze", tagSources: { musicbrainz: 1, lastfm: 2, none: 0 } })]);
  assert.deepEqual(run.results[0]!.tagSources, { musicbrainz: 1, lastfm: 2, none: 0 });
  assert.equal(run.config.metricsVersion, 3);
});

test("a golden run records constraint rates and averages them over the queries that have them", () => {
  const run = record([
    result({ id: "blackgaze", constraintRateAt8: 1, constraintVerdicts: { met: 3, missed: 0, unknown: 0 } }),
    result({ id: "zeuhl", constraintRateAt8: 0.5, constraintVerdicts: { met: 1, missed: 1, unknown: 1 }, status: "fail", passed: false, failedGates: ["constraint"] }),
    result({ id: "dungeon-synth" }),
  ]);

  assert.equal(run.summary.constraintRateMean, 0.75);
  assert.equal(run.results[1]!.metrics?.constraintRateAt8, 0.5);
  assert.deepEqual(run.results[1]!.failedGates, ["constraint"]);
  assert.equal(run.config.metricsVersion, 3);
});

test("constraints are grading targets: changing one changes the content hash", () => {
  const base = goldenSetHashes(entries);
  const constrained = goldenSetHashes(entries.map((e) => (e.id === "zeuhl" ? { ...e, constraints: { country: "FR" } } : e)));
  assert.equal(constrained.questionsHash, base.questionsHash);
  assert.notEqual(constrained.contentHash, base.contentHash);
});

test("the run summary counts failed queries per gate", () => {
  const run = record([
    result({ id: "blackgaze", status: "fail", passed: false, failedGates: ["constraint"] }),
    result({ id: "zeuhl", status: "fail", passed: false, failedGates: ["coverage", "antiBand"] }),
    result({ id: "dungeon-synth", status: "fail", passed: false, failedGates: ["noResults"] }),
  ]);
  assert.deepEqual(run.summary.failuresByGate, { antiBand: 1, coverage: 1, constraint: 1, noResults: 1 });
});

test("a judged run records the judge and the mean judge scores over judged queries", () => {
  const scores = (v: number) => ({ relevance: v, obscurityFit: v, evidenceQuality: v, discoveryValue: v });
  const run = buildGoldenRunRecord({
    entries,
    results: [result({ id: "blackgaze", judgeScores: scores(1) }), result({ id: "zeuhl", judgeScores: scores(0.5) }), result({ id: "dungeon-synth" })],
    startedAt: new Date("2026-10-05T10:15:00Z"),
    finishedAt: new Date("2026-10-05T10:45:00Z"),
    label: null,
    notes: null,
    git: null,
    apiUrl: "http://localhost:3001",
    judge: { model: "llama-3.3-70b-instruct", reasoningEffort: "none", votes: 3 },
  });
  assert.deepEqual(run.config.judge, { model: "llama-3.3-70b-instruct", reasoningEffort: "none", votes: 3 });
  assert.deepEqual(run.summary.judgeMeans, scores(0.75));
  assert.deepEqual(run.results[0]!.judgeScores, scores(1));
});

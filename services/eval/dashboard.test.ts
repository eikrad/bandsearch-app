import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compareRuns,
  compareSetups,
  dashboardData,
  groupSetups,
  renderHtml,
  signTest,
  top8Overlap,
} from "./dashboard.ts";
import { buildGoldenRunRecord, type GoldenRunRecord } from "./history.ts";
import type { GoldenEntry, GoldenResult } from "./run-golden.ts";

const entries: GoldenEntry[] = [
  { id: "blackgaze", query: "bands like Alcest", nuggets: ["blackgaze"] },
  { id: "zeuhl", query: "zeuhl like Magma", nuggets: ["zeuhl"] },
  { id: "drone", query: "drone like Sunn O)))", nuggets: ["drone"] },
];

type Outcome = "pass" | "fail" | "error";

function result(id: string, outcome: Outcome, top: string[] = ["Fen", "Ghost Bath"]): GoldenResult {
  return {
    id,
    query: id,
    status: outcome,
    passed: outcome === "pass",
    resultNames: outcome === "error" ? [] : top,
    antiBandRateAt8: 0,
    nuggetCoverageAt8: outcome === "pass" ? 1 : 0,
    uncoveredNuggets: [],
    warnings: [],
    latencyMs: outcome === "error" ? null : 1000,
    model: outcome === "error" ? null : "gemini-2.5-flash",
    pipelineVersion: "0.4.0",
    replay: outcome === "error" ? null : false,
    tagSources: { musicbrainz: top.length, lastfm: 0, none: 0 },
    constraintRateAt8: null,
    constraintVerdicts: null,
    failedGates: outcome === "fail" ? ["coverage"] : [],
    ...(outcome === "error" ? { error: "API error 502" } : {}),
  };
}

let minute = 0;
function run(
  outcomes: Record<string, Outcome | { outcome: Outcome; top: string[] }>,
  overrides: {
    label?: string;
    model?: string;
    goldenSet?: GoldenEntry[];
    commit?: string;
    dirty?: boolean;
  } = {},
): GoldenRunRecord {
  minute += 1;
  const startedAt = new Date(Date.UTC(2026, 9, 5, 10, minute));
  const results = Object.entries(outcomes).map(([id, o]) => {
    const r = typeof o === "string" ? result(id, o) : result(id, o.outcome, o.top);
    return overrides.model && r.status !== "error" ? { ...r, model: overrides.model } : r;
  });
  return buildGoldenRunRecord({
    entries: overrides.goldenSet ?? entries,
    results,
    startedAt,
    finishedAt: new Date(startedAt.getTime() + 60_000),
    label: overrides.label ?? null,
    notes: null,
    git: { commit: overrides.commit ?? "abc1234", branch: "staging", dirty: overrides.dirty ?? false },
    apiUrl: "http://localhost:3001",
  });
}

// ─── sign test ────────────────────────────────────────────────────────────────

test("no flipped query gives no p-value", () => {
  assert.deepEqual(signTest(0, 0), { flipped: 0, pValue: null, significant: false });
});

test("five flips all one way are still not significant", () => {
  const result = signTest(0, 5);
  assert.equal(result.pValue, 0.0625);
  assert.equal(result.significant, false);
});

test("six flips all one way are significant", () => {
  const result = signTest(6, 0);
  assert.equal(result.pValue, 0.03125);
  assert.equal(result.significant, true);
});

// ─── answer overlap ───────────────────────────────────────────────────────────

test("top-8 overlap ignores order and case", () => {
  assert.equal(top8Overlap(["Fen", "Alcest"], ["alcest", "FEN"]), 1);
});

test("top-8 overlap is the shared share of the longer list", () => {
  assert.equal(top8Overlap(["A", "B", "C", "D"], ["A", "B"]), 0.5);
});

test("two empty answers have no overlap to speak of", () => {
  assert.equal(top8Overlap([], []), null);
});

// ─── comparing two runs ───────────────────────────────────────────────────────

test("a query that passed before and fails now is a regression, the reverse an improvement", () => {
  const before = run({ blackgaze: "pass", zeuhl: "fail", drone: "pass" });
  const after = run({ blackgaze: "fail", zeuhl: "pass", drone: "pass" });

  const cmp = compareRuns(before, after);

  assert.deepEqual(cmp.regressions.map((q) => q.id), ["blackgaze"]);
  assert.deepEqual(cmp.improvements.map((q) => q.id), ["zeuhl"]);
  assert.equal(cmp.verdict, "1 regression, 1 improvement");
  assert.equal(cmp.significance.flipped, 2);
});

test("a query the API did not answer in either run is no evidence either way", () => {
  const before = run({ blackgaze: "pass", zeuhl: "pass", drone: "pass" });
  const after = run({ blackgaze: "error", zeuhl: "pass", drone: "pass" });

  const cmp = compareRuns(before, after);

  assert.equal(cmp.regressions.length, 0, "an outage is not a quality regression");
  assert.deepEqual(cmp.unanswered, ["blackgaze"]);
});

test("a comparison reports how much the answers overlap, per query and on average", () => {
  const before = run({
    blackgaze: { outcome: "pass", top: ["Fen", "Ghost Bath"] },
    zeuhl: { outcome: "pass", top: ["Magma", "Univers Zero"] },
    drone: "error",
  });
  const after = run({
    blackgaze: { outcome: "pass", top: ["Fen", "Ghost Bath"] },
    zeuhl: { outcome: "pass", top: ["Magma", "Eskaton"] },
    drone: { outcome: "pass", top: ["Earth"] },
  });

  const cmp = compareRuns(before, after);

  assert.equal(cmp.overlap.byQuery.blackgaze, 1);
  assert.equal(cmp.overlap.byQuery.zeuhl, 0.5);
  assert.equal(cmp.overlap.byQuery.drone, undefined, "unanswered before: nothing to overlap with");
  assert.equal(cmp.overlap.mean, 0.75);
});

test("a changed model shows up in the settings diff", () => {
  const before = run({ blackgaze: "pass" }, { model: "gemini-2.5-flash" });
  const after = run({ blackgaze: "pass" }, { model: "gemma-4-26b-a4b-it" });

  const cmp = compareRuns(before, after);

  assert.deepEqual(cmp.configDiff, [
    { field: "researchModel", before: "gemini-2.5-flash", after: "gemma-4-26b-a4b-it" },
  ]);
});

test("runs graded against different targets get no regression verdict", () => {
  const regraded = entries.map((e) => (e.id === "zeuhl" ? { ...e, nuggets: ["zeuhl", "jazz fusion"] } : e));
  const before = run({ blackgaze: "pass", zeuhl: "pass" });
  const after = run({ blackgaze: "fail", zeuhl: "pass" }, { goldenSet: regraded });

  const cmp = compareRuns(before, after);

  assert.equal(cmp.comparable, false);
  assert.equal(cmp.verdict, "Not directly comparable: grading targets changed");
});

test("a run on uncommitted changes carries a caveat", () => {
  const cmp = compareRuns(run({ blackgaze: "pass" }), run({ blackgaze: "pass" }, { dirty: true }));
  assert.ok(cmp.warnings.some((w) => /uncommitted changes/.test(w)));
});

// ─── the whole history ────────────────────────────────────────────────────────

test("runs on different question sets are never compared with each other", () => {
  const other: GoldenEntry[] = [{ id: "shoegaze", query: "shoegaze like Slowdive" }];
  const data = dashboardData([
    run({ blackgaze: "pass" }),
    run({ shoegaze: "pass" }, { goldenSet: other }),
    run({ blackgaze: "fail" }),
  ]);

  assert.equal(data.sets.length, 2);
  const main = data.sets.find((s) => s.nItems === 3)!;
  assert.equal(main.runIds.length, 2);
});

test("the baseline is the latest run labelled baseline, else the set's first run", () => {
  const first = run({ blackgaze: "pass" });
  const old = run({ blackgaze: "pass" }, { label: "baseline" });
  const current = run({ blackgaze: "pass" }, { label: "baseline" });
  const later = run({ blackgaze: "fail" });

  assert.equal(dashboardData([first, later]).sets[0]!.baselineRunId, first.runId);
  assert.equal(dashboardData([first, old, current, later]).sets[0]!.baselineRunId, current.runId);
  assert.equal(
    dashboardData([first, old, current, later], { baselineRunId: old.runId }).sets[0]!.baselineRunId,
    old.runId,
  );
});

test("repeat runs of the same setup give the noise floor for answer overlap", () => {
  const a = run({ blackgaze: { outcome: "pass", top: ["Fen", "Ghost Bath"] } }, { model: "m1" });
  const b = run({ blackgaze: { outcome: "pass", top: ["Fen", "Alcest"] } }, { model: "m1" });
  const c = run({ blackgaze: { outcome: "pass", top: ["Earth"] } }, { model: "m2" });

  const set = dashboardData([a, b, c]).sets[0]!;

  assert.equal(set.noiseFloor?.overlapMean, 0.5, "only a→b repeat the same setup");
  assert.equal(set.noiseFloor?.pairs, 1);
});

test("a history without repeat runs has no noise floor yet", () => {
  const set = dashboardData([run({ blackgaze: "pass" }, { model: "m1" }), run({ blackgaze: "pass" }, { model: "m2" })])
    .sets[0]!;
  assert.equal(set.noiseFloor, null);
});

// ─── the page ─────────────────────────────────────────────────────────────────

test("text from the history cannot close the page's data script", () => {
  const record = { ...run({ blackgaze: "pass" }), notes: "</script><script>alert(1)</script>" };
  const html = renderHtml(dashboardData([record]));
  assert.ok(!html.includes("</script><script>alert(1)"));
  assert.ok(html.includes("\\u003c/script>"));
});

// ─── setups: repeats of one configuration, compared per query (#250) ─────────

function coverage(id: string, value: number | null, outcome: Outcome = "pass"): GoldenResult {
  return { ...result(id, outcome), nuggetCoverageAt8: value };
}

function runWith(results: GoldenResult[], model: string): GoldenRunRecord {
  minute += 1;
  const startedAt = new Date(Date.UTC(2026, 9, 6, 10, minute));
  return buildGoldenRunRecord({
    entries,
    results: results.map((r) => (r.status === "error" ? r : { ...r, model })),
    startedAt,
    finishedAt: new Date(startedAt.getTime() + 60_000),
    label: null,
    notes: null,
    git: { commit: "abc1234", branch: "b", dirty: false },
    apiUrl: "http://localhost:3001",
  });
}

test("repeat runs of one model on one commit form one setup", () => {
  const a1 = runWith([coverage("blackgaze", 1)], "gemini");
  const a2 = runWith([coverage("blackgaze", 0.5)], "gemini");
  const b1 = runWith([coverage("blackgaze", 0)], "gemma");

  const setups = groupSetups([a1, a2, b1]);

  assert.equal(setups.length, 2);
  assert.deepEqual(setups.find((s) => s.researchModel === "gemini")!.runIds, [a1.runId, a2.runId]);
});

test("two setups are compared per query, averaged over their repeats", () => {
  const base = [
    runWith([coverage("blackgaze", 1), coverage("zeuhl", 0.5), coverage("drone", 0)], "gemini"),
    runWith([coverage("blackgaze", 0), coverage("zeuhl", 0.5), coverage("drone", 0)], "gemini"),
  ];
  const candidate = [
    runWith([coverage("blackgaze", 1), coverage("zeuhl", 1), coverage("drone", 0.5)], "gemma"),
    runWith([coverage("blackgaze", 1), coverage("zeuhl", 1), coverage("drone", 0.5)], "gemma"),
  ];

  const cmp = compareSetups(base, candidate);

  // per-query differences: blackgaze 1 - 0.5, zeuhl 1 - 0.5, drone 0.5 - 0
  assert.equal(cmp.coverage.nQueries, 3);
  assert.equal(cmp.coverage.meanDiff, 0.5);
  assert.ok(cmp.coverage.ci95![0] <= 0.5 && 0.5 <= cmp.coverage.ci95![1]);
  assert.equal(cmp.coverage.ci95![0], 0.5, "every query moved by exactly 0.5, so the interval has no width");
});

test("a difference whose interval includes zero is not called a finding", () => {
  const base = [runWith([coverage("blackgaze", 1), coverage("zeuhl", 0), coverage("drone", 0.5)], "gemini")];
  const candidate = [runWith([coverage("blackgaze", 0), coverage("zeuhl", 1), coverage("drone", 0.5)], "gemma")];

  const cmp = compareSetups(base, candidate);

  assert.equal(cmp.coverage.meanDiff, 0);
  assert.ok(cmp.coverage.ci95![0] < 0 && cmp.coverage.ci95![1] > 0);
  assert.equal(cmp.coverage.clear, false);
});

test("queries a setup never answered, or whose coverage is unknown, drop out of that comparison", () => {
  const base = [runWith([coverage("blackgaze", 1), coverage("zeuhl", null), result("drone", "error")], "gemini")];
  const candidate = [runWith([coverage("blackgaze", 0.5), coverage("zeuhl", 1), coverage("drone", 1)], "gemma")];

  const cmp = compareSetups(base, candidate);

  assert.equal(cmp.coverage.nQueries, 1, "only blackgaze has a known coverage in both");
  assert.equal(cmp.passRate.nQueries, 2, "drone was never answered by the base setup");
});

test("the paired bootstrap is reproducible: the same runs give the same interval", () => {
  const base = [runWith([coverage("blackgaze", 0.2), coverage("zeuhl", 0.4), coverage("drone", 0.9)], "gemini")];
  const candidate = [runWith([coverage("blackgaze", 0.6), coverage("zeuhl", 0.3), coverage("drone", 1)], "gemma")];
  assert.deepEqual(compareSetups(base, candidate).coverage.ci95, compareSetups(base, candidate).coverage.ci95);
});

test("setups are also compared on how often their bands meet hard constraints", () => {
  const withRate = (id: string, rate: number): GoldenResult => ({ ...result(id, "pass"), constraintRateAt8: rate });
  const base = [runWith([withRate("blackgaze", 0.5), withRate("zeuhl", 0.5)], "gemini")];
  const candidate = [runWith([withRate("blackgaze", 1), withRate("zeuhl", 1)], "gemma")];

  const cmp = compareSetups(base, candidate);

  assert.equal(cmp.constraintRate.nQueries, 2);
  assert.equal(cmp.constraintRate.meanDiff, 0.5);
  assert.equal(groupSetups(candidate)[0]!.constraintRateMean, 1);
});

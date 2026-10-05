/**
 * Local HTML dashboard comparing golden runs over time.
 *
 *     npm run dashboard -w services/eval [-- --baseline RUN_ID] [--output PATH]
 *
 * Reads history/golden-runs.jsonl and writes one self-contained page. All
 * comparison logic lives here (tested); the page's script only draws what
 * dashboardData() computed. Ported from the Radiationsafety eval dashboard.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { loadRuns, type GoldenRunRecord, type GoldenRunResult } from "./history.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(__dirname, "dashboard-template.html");
const DATA_PLACEHOLDER = "__DASHBOARD_DATA__";
export const DEFAULT_DASHBOARD_PATH = join(__dirname, "reports", "dashboard.html");
const DEFAULT_HISTORY_PATH = join(__dirname, "history", "golden-runs.jsonl");

export type SignTest = { flipped: number; pValue: number | null; significant: boolean };

export type QueryChange = {
  id: string;
  query: string;
  before: GoldenRunResult;
  after: GoldenRunResult;
};

export type Comparison = {
  baseRunId: string;
  runId: string;
  comparable: boolean;
  verdict: string;
  regressions: QueryChange[];
  improvements: QueryChange[];
  /** Same pass/fail, different metrics or top 8. */
  changed: QueryChange[];
  /** Ids the API did not answer in one of the two runs; no evidence either way. */
  unanswered: string[];
  significance: SignTest;
  /** How much the top 8 stayed the same: per query, and the mean over queries answered in both. */
  overlap: { byQuery: Record<string, number>; mean: number | null };
  summaryDelta: Record<string, number>;
  configDiff: Array<{ field: string; before: unknown; after: unknown }>;
  commits: [string | null, string | null];
  warnings: string[];
};

export type QuestionSet = {
  questionsHash: string;
  nItems: number;
  questions: Array<{ id: string; query: string }>;
  runIds: string[];
  baselineRunId: string | null;
  markers: Array<{ runId: string; reasons: string[] }>;
  comparisons: Record<string, { previous: Comparison | null; baseline: Comparison | null }>;
  /**
   * Mean top-8 overlap between runs of the identical setup (same model,
   * pipeline, commit and grading targets): how much answers move by chance.
   * An overlap with the baseline near this floor says the change did little.
   */
  noiseFloor: { overlapMean: number; pairs: number } | null;
  /** One entry per configuration; repeats are grouped. */
  setups: SetupSummary[];
  /** The setup containing the baseline run. */
  baselineSetupKey: string | null;
  /** Every other setup against the baseline setup, keyed by setup key. */
  setupComparisons: Record<string, ReturnType<typeof compareSetups>>;
};

export type DashboardData = {
  runs: Record<string, GoldenRunRecord>;
  sets: QuestionSet[];
};

/**
 * Exact two-sided sign test over queries that flipped between pass and fail.
 * Under "no real change" each flip goes either way with p = 0.5; unchanged
 * queries carry no information about direction and are left out. With few
 * flips nothing can be significant: 5 of 5 one way still gives p = 0.0625.
 */
export function signTest(regressions: number, improvements: number, alpha = 0.05): SignTest {
  const n = regressions + improvements;
  if (n === 0) return { flipped: 0, pValue: null, significant: false };
  let tail = 0;
  for (let i = 0; i <= Math.min(regressions, improvements); i += 1) tail += binomial(n, i);
  const pValue = Math.min(1, (2 * tail) / 2 ** n);
  return { flipped: n, pValue, significant: pValue < alpha };
}

function binomial(n: number, k: number): number {
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return result;
}

/** Shared bands as a share of the longer list; null when both are empty. */
export function top8Overlap(a: string[], b: string[]): number | null {
  const left = new Set(a.slice(0, 8).map((n) => n.toLowerCase()));
  const right = new Set(b.slice(0, 8).map((n) => n.toLowerCase()));
  const size = Math.max(left.size, right.size);
  if (size === 0) return null;
  return [...left].filter((n) => right.has(n)).length / size;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Why scores on either side of this pair do not mean the same thing. */
function incomparability(before: GoldenRunRecord, after: GoldenRunRecord): string[] {
  const reasons: string[] = [];
  if (before.dataset.contentHash !== after.dataset.contentHash) reasons.push("grading targets changed");
  if (before.config.metricsVersion !== after.config.metricsVersion) reasons.push("scoring changed");
  return reasons;
}

function answerOverlap(base: GoldenRunRecord, run: GoldenRunRecord): Comparison["overlap"] {
  const baseResults = new Map(base.results.map((r) => [r.id, r]));
  const byQuery: Record<string, number> = {};
  for (const after of run.results) {
    const before = baseResults.get(after.id);
    if (!before || before.status === "error" || after.status === "error") continue;
    const overlap = top8Overlap(before.top8, after.top8);
    if (overlap !== null) byQuery[after.id] = overlap;
  }
  return { byQuery, mean: mean(Object.values(byQuery)) };
}

export function compareRuns(base: GoldenRunRecord, run: GoldenRunRecord): Comparison {
  const baseResults = new Map(base.results.map((r) => [r.id, r]));
  const regressions: QueryChange[] = [];
  const improvements: QueryChange[] = [];
  const changed: QueryChange[] = [];
  const unanswered: string[] = [];

  for (const after of run.results) {
    const before = baseResults.get(after.id);
    if (!before) continue;
    if (before.status === "error" || after.status === "error") {
      unanswered.push(after.id);
      continue;
    }
    const change = { id: after.id, query: after.query, before, after };
    if (before.status === "pass" && after.status === "fail") regressions.push(change);
    else if (before.status === "fail" && after.status === "pass") improvements.push(change);
    else if (
      JSON.stringify(before.metrics) !== JSON.stringify(after.metrics) ||
      top8Overlap(before.top8, after.top8) !== 1
    ) {
      changed.push(change);
    }
  }

  const reasons = incomparability(base, run);
  const warnings = [...reasons];
  for (const r of [base, run]) {
    if (r.git?.dirty) warnings.push(`run ${r.runId} had uncommitted changes`);
    if (r.summary.errorRate > 0) {
      warnings.push(`run ${r.runId}: ${Math.round(r.summary.errorRate * 100)}% of queries got no answer`);
    }
  }

  const summaryDelta: Record<string, number> = {};
  for (const [key, value] of Object.entries(run.summary)) {
    const before = (base.summary as Record<string, number | null>)[key];
    if (typeof value === "number" && typeof before === "number") summaryDelta[key] = value - before;
  }

  return {
    baseRunId: base.runId,
    runId: run.runId,
    comparable: reasons.length === 0,
    // Across a change of grading targets or scoring, flips reflect the new
    // rules as much as the system, so no regression/improvement verdict.
    verdict:
      reasons.length > 0
        ? `Not directly comparable: ${reasons.join(", ")}`
        : `${plural(regressions.length, "regression")}, ${plural(improvements.length, "improvement")}`,
    regressions,
    improvements,
    changed,
    unanswered,
    significance: signTest(regressions.length, improvements.length),
    overlap: answerOverlap(base, run),
    summaryDelta,
    configDiff: diff(base.config, run.config),
    commits: [base.git?.commit ?? null, run.git?.commit ?? null],
    warnings,
  };
}

function diff(before: object, after: object): Comparison["configDiff"] {
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .sort()
    .filter((key) => JSON.stringify(b[key]) !== JSON.stringify(a[key]))
    .map((field) => ({ field, before: b[field], after: a[field] }));
}

function pickBaseline(runs: GoldenRunRecord[], baselineRunId?: string): GoldenRunRecord | null {
  if (baselineRunId) {
    const chosen = runs.find((r) => r.runId === baselineRunId);
    if (chosen) return chosen;
  }
  const labelled = runs.filter((r) => r.label === "baseline");
  return labelled.at(-1) ?? runs[0] ?? null;
}

/** Runs with this key differ only by chance: same model, pipeline, code and targets. */
function setupKey(run: GoldenRunRecord): string {
  return JSON.stringify([
    run.config.researchModel,
    run.config.pipelineVersion,
    run.config.apiUrl,
    run.config.replay ?? null,
    run.git?.commit ?? null,
    run.git?.dirty ?? null,
    run.dataset.contentHash,
    run.config.metricsVersion,
  ]);
}

function noiseFloor(runs: GoldenRunRecord[]): QuestionSet["noiseFloor"] {
  const groups = new Map<string, GoldenRunRecord[]>();
  for (const run of runs) {
    if (run.config.researchModel === null) continue;
    const key = setupKey(run);
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  const overlaps: number[] = [];
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const overlap = answerOverlap(group[i]!, group[j]!).mean;
        if (overlap !== null) overlaps.push(overlap);
      }
    }
  }
  const overlapMean = mean(overlaps);
  return overlapMean === null ? null : { overlapMean, pairs: overlaps.length };
}

// ─── setups: repeats of one configuration (#250) ──────────────────────────────

export type SetupSummary = {
  key: string;
  researchModel: string | null;
  replay: GoldenRunRecord["config"]["replay"];
  commit: string | null;
  pipelineVersion: string | null;
  runIds: string[];
  passRate: { mean: number | null; min: number | null; max: number | null };
  nuggetCoverageMean: number | null;
  latencyMsMedian: number | null;
  errorRate: number | null;
};

/** Runs that differ only by chance, grouped; one entry per configuration, oldest first. */
export function groupSetups(runs: GoldenRunRecord[]): SetupSummary[] {
  const groups = new Map<string, GoldenRunRecord[]>();
  for (const run of [...runs].sort((a, b) => a.runId.localeCompare(b.runId))) {
    const key = setupKey(run);
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  return [...groups.entries()].map(([key, group]) => {
    const passRates = group.map((r) => r.summary.passRate).filter((v): v is number => v !== null);
    const first = group[0]!;
    return {
      key,
      researchModel: first.config.researchModel,
      replay: first.config.replay ?? null,
      commit: first.git?.commit ?? null,
      pipelineVersion: first.config.pipelineVersion,
      runIds: group.map((r) => r.runId),
      passRate: {
        mean: mean(passRates),
        min: passRates.length ? Math.min(...passRates) : null,
        max: passRates.length ? Math.max(...passRates) : null,
      },
      nuggetCoverageMean: mean(group.map((r) => r.summary.nuggetCoverageMean).filter((v): v is number => v !== null)),
      latencyMsMedian: mean(group.map((r) => r.summary.latencyMsMedian).filter((v): v is number => v !== null)),
      errorRate: mean(group.map((r) => r.summary.errorRate)),
    };
  });
}

export type PairedDiff = {
  /** Queries with a value in both setups. */
  nQueries: number;
  /** Mean over queries of (candidate − base), each side averaged over its repeats. */
  meanDiff: number | null;
  /** Paired bootstrap over queries, 95 %. */
  ci95: [number, number] | null;
  /** The interval excludes zero: a difference larger than the noise. */
  clear: boolean;
};

type Metric = "pass" | "coverage" | "antiBand";

function valueOf(result: GoldenRunResult, metric: Metric): number | null {
  if (result.status === "error" || !result.metrics) return null;
  if (metric === "pass") return result.status === "pass" ? 1 : 0;
  if (metric === "coverage") return result.metrics.nuggetCoverageAt8;
  return result.metrics.antiBandRateAt8;
}

function perQueryMeans(runs: GoldenRunRecord[], metric: Metric): Map<string, number> {
  const values = new Map<string, number[]>();
  for (const run of runs) {
    for (const result of run.results) {
      const v = valueOf(result, metric);
      if (v !== null) values.set(result.id, [...(values.get(result.id) ?? []), v]);
    }
  }
  return new Map([...values.entries()].map(([id, vs]) => [id, mean(vs)!]));
}

/** Small seeded PRNG (mulberry32), so the same runs always give the same interval. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BOOTSTRAP_RESAMPLES = 2000;

function pairedDiff(base: GoldenRunRecord[], candidate: GoldenRunRecord[], metric: Metric): PairedDiff {
  const before = perQueryMeans(base, metric);
  const after = perQueryMeans(candidate, metric);
  const diffs = [...after.entries()].filter(([id]) => before.has(id)).map(([id, v]) => v - before.get(id)!);
  if (diffs.length === 0) return { nQueries: 0, meanDiff: null, ci95: null, clear: false };

  const random = seededRandom(20261005);
  const resampled: number[] = [];
  for (let b = 0; b < BOOTSTRAP_RESAMPLES; b += 1) {
    let sum = 0;
    for (let i = 0; i < diffs.length; i += 1) sum += diffs[Math.floor(random() * diffs.length)]!;
    resampled.push(sum / diffs.length);
  }
  resampled.sort((x, y) => x - y);
  const ci95: [number, number] = [
    resampled[Math.floor(0.025 * BOOTSTRAP_RESAMPLES)]!,
    resampled[Math.floor(0.975 * BOOTSTRAP_RESAMPLES) - 1]!,
  ];
  return { nQueries: diffs.length, meanDiff: mean(diffs), ci95, clear: ci95[0] > 0 || ci95[1] < 0 };
}

/**
 * Compares two setups query by query. Each query's value is averaged over a
 * setup's repeats first, so the noise of single runs averages out; the
 * interval comes from resampling queries, the unit that varies most.
 */
export function compareSetups(
  base: GoldenRunRecord[],
  candidate: GoldenRunRecord[],
): { passRate: PairedDiff; coverage: PairedDiff; antiBandRate: PairedDiff } {
  return {
    passRate: pairedDiff(base, candidate, "pass"),
    coverage: pairedDiff(base, candidate, "coverage"),
    antiBandRate: pairedDiff(base, candidate, "antiBand"),
  };
}

function questionSet(questionsHash: string, runs: GoldenRunRecord[], baselineRunId?: string): QuestionSet {
  const latest = runs.at(-1)!;
  const baseline = pickBaseline(runs, baselineRunId);
  const comparisons: QuestionSet["comparisons"] = {};
  const markers: QuestionSet["markers"] = [];
  runs.forEach((run, i) => {
    const previous = i > 0 ? runs[i - 1]! : null;
    const againstBaseline = baseline && baseline.runId < run.runId ? baseline : null;
    comparisons[run.runId] = {
      previous: previous ? compareRuns(previous, run) : null,
      baseline: againstBaseline ? compareRuns(againstBaseline, run) : null,
    };
    if (previous) {
      const reasons = incomparability(previous, run);
      if (reasons.length > 0) markers.push({ runId: run.runId, reasons });
    }
  });
  return {
    questionsHash,
    nItems: latest.dataset.nItems,
    questions: latest.results.map((r) => ({ id: r.id, query: r.query })),
    runIds: runs.map((r) => r.runId),
    baselineRunId: baseline?.runId ?? null,
    markers,
    comparisons,
    noiseFloor: noiseFloor(runs),
    ...setupView(runs, baseline),
  };
}

function setupView(
  runs: GoldenRunRecord[],
  baseline: GoldenRunRecord | null,
): Pick<QuestionSet, "setups" | "baselineSetupKey" | "setupComparisons"> {
  const setups = groupSetups(runs);
  const baselineSetupKey = baseline ? setupKey(baseline) : null;
  const runsOf = (key: string) => runs.filter((r) => setupKey(r) === key);
  const setupComparisons: QuestionSet["setupComparisons"] = {};
  if (baselineSetupKey) {
    for (const setup of setups) {
      if (setup.key !== baselineSetupKey) {
        setupComparisons[setup.key] = compareSetups(runsOf(baselineSetupKey), runsOf(setup.key));
      }
    }
  }
  return { setups, baselineSetupKey, setupComparisons };
}

export function dashboardData(runs: GoldenRunRecord[], options: { baselineRunId?: string } = {}): DashboardData {
  const sorted = [...runs].sort((a, b) => a.runId.localeCompare(b.runId));
  const bySet = new Map<string, GoldenRunRecord[]>();
  for (const run of sorted) {
    const key = run.dataset.questionsHash;
    bySet.set(key, [...(bySet.get(key) ?? []), run]);
  }
  const sets = [...bySet.entries()]
    .map(([hash, setRuns]) => questionSet(hash, setRuns, options.baselineRunId))
    // The set with the most recent run first: that is what one usually looks at.
    .sort((a, b) => b.runIds.at(-1)!.localeCompare(a.runIds.at(-1)!));
  return { runs: Object.fromEntries(sorted.map((r) => [r.runId, r])), sets };
}

/**
 * The page with `data` embedded as JSON. "<" is escaped so no text in the
 * history (a query, a label, a note) can close the <script> element.
 */
export function renderHtml(data: DashboardData): string {
  const payload = JSON.stringify(data).replaceAll("<", "\\u003c");
  return readFileSync(TEMPLATE_PATH, "utf8").replace(DATA_PLACEHOLDER, () => payload);
}

export function writeDashboard({
  output = DEFAULT_DASHBOARD_PATH,
  historyPath = DEFAULT_HISTORY_PATH,
  baselineRunId,
}: { output?: string; historyPath?: string; baselineRunId?: string } = {}): string {
  const data = dashboardData(loadRuns<GoldenRunRecord>(historyPath), { baselineRunId });
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, renderHtml(data), "utf8");
  return output;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      baseline: { type: "string" },
      output: { type: "string" },
      history: { type: "string" },
    },
  });
  const path = writeDashboard({
    output: values.output,
    historyPath: values.history,
    baselineRunId: values.baseline,
  });
  console.log(`Dashboard written: ${pathToFileURL(path).href}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

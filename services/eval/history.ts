import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import type { GoldenEntry, GoldenResult } from "./run-golden.ts";

/**
 * Bump when a golden metric's definition changes. The dashboard then marks
 * runs on either side as not directly comparable instead of reporting the
 * change as a regression or an improvement.
 */
export const GOLDEN_METRICS_VERSION = 1;

export type GitState = { commit: string; branch: string; dirty: boolean };

/** One line of `history/golden-runs.jsonl`: what was tested and what came out. */
export type GoldenRunRecord = {
  schema: 1;
  /** UTC start time as `YYYYMMDD_HHMMSS`; sorts chronologically as a string. */
  runId: string;
  timestamp: string;
  /** Short name for the run; the latest run labelled `baseline` is what others compare against. */
  label: string | null;
  notes: string | null;
  git: GitState | null;
  dataset: {
    /** Ids, queries and obscurity targets: runs with the same value answered the same questions. */
    questionsHash: string;
    /** Also nuggets, anti-bands and thresholds: changes when the grading targets change. */
    contentHash: string;
    nItems: number;
  };
  config: {
    apiUrl: string;
    /** As reported by the API in `meta.model`, never assumed by the runner. */
    researchModel: string | null;
    pipelineVersion: string | null;
    metricsVersion: number;
  };
  durationSec: number;
  summary: {
    /** Over answered queries; null when none was answered. */
    passRate: number | null;
    nuggetCoverageMean: number | null;
    antiBandRateMean: number | null;
    /** Share of queries the runner got no answer to. */
    errorRate: number;
    latencyMsMedian: number | null;
    latencyMsMax: number | null;
  };
  results: GoldenRunResult[];
};

export type GoldenRunResult = {
  id: string;
  query: string;
  status: GoldenResult["status"];
  /** Null for an errored query: it has no score, which is not a score of zero. */
  metrics: { nuggetCoverageAt8: number; antiBandRateAt8: number } | null;
  latencyMs: number | null;
  model: string | null;
  top8: string[];
  uncoveredNuggets: string[];
  warnings: string[];
  error?: string;
};

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 12);
}

export function goldenSetHashes(entries: GoldenEntry[]): { questionsHash: string; contentHash: string } {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  return {
    questionsHash: sha256(sorted.map((e) => [e.id, e.query, e.obscurityTarget ?? null])),
    contentHash: sha256(
      sorted.map((e) => [
        e.id,
        e.query,
        e.obscurityTarget ?? null,
        e.nuggets ?? [],
        e.antiBands ?? [],
        e.minNuggetCoverage ?? null,
      ]),
    ),
  };
}

function runIdFor(date: Date): string {
  const iso = date.toISOString(); // 2026-10-05T10:15:00.000Z
  return `${iso.slice(0, 10).replaceAll("-", "")}_${iso.slice(11, 19).replaceAll(":", "")}`;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function distinct<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/** One value if every answered query agrees, a visible "mixed" otherwise. */
function reportedValue(values: Array<string | null>): string | null {
  const reported = distinct(values.filter((v): v is string => v !== null));
  if (reported.length === 0) return null;
  return reported.length === 1 ? reported[0]! : `mixed: ${reported.join(", ")}`;
}

export function buildGoldenRunRecord({
  entries,
  results,
  startedAt,
  finishedAt,
  label,
  notes,
  git,
  apiUrl,
}: {
  entries: GoldenEntry[];
  results: GoldenResult[];
  startedAt: Date;
  finishedAt: Date;
  label: string | null;
  notes: string | null;
  git: GitState | null;
  apiUrl: string;
}): GoldenRunRecord {
  const answered = results.filter((r) => r.status !== "error");
  const latencies = answered.map((r) => r.latencyMs).filter((l): l is number => l !== null);

  return {
    schema: 1,
    runId: runIdFor(startedAt),
    timestamp: startedAt.toISOString(),
    label,
    notes,
    git,
    dataset: { ...goldenSetHashes(entries), nItems: entries.length },
    config: {
      apiUrl,
      researchModel: reportedValue(answered.map((r) => r.model)),
      pipelineVersion: reportedValue(answered.map((r) => r.pipelineVersion)),
      metricsVersion: GOLDEN_METRICS_VERSION,
    },
    durationSec: Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
    summary: {
      passRate: answered.length === 0 ? null : answered.filter((r) => r.passed).length / answered.length,
      nuggetCoverageMean: mean(answered.map((r) => r.nuggetCoverageAt8)),
      antiBandRateMean: mean(answered.map((r) => r.antiBandRateAt8)),
      errorRate: results.length === 0 ? 0 : (results.length - answered.length) / results.length,
      latencyMsMedian: median(latencies),
      latencyMsMax: latencies.length === 0 ? null : Math.max(...latencies),
    },
    results: results.map((r) => ({
      id: r.id,
      query: r.query,
      status: r.status,
      metrics:
        r.status === "error"
          ? null
          : { nuggetCoverageAt8: r.nuggetCoverageAt8, antiBandRateAt8: r.antiBandRateAt8 },
      latencyMs: r.latencyMs,
      model: r.model,
      top8: r.resultNames.slice(0, 8),
      uncoveredNuggets: r.uncoveredNuggets,
      warnings: r.warnings,
      ...(r.error !== undefined ? { error: r.error } : {}),
    })),
  };
}

export function appendRun<T extends { runId: string }>(path: string, record: T): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
}

/** All runs in file order. A damaged line is an error, never silently skipped. */
export function loadRuns<T = GoldenRunRecord>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => line.trim() !== "")
    .map(({ line, n }) => {
      try {
        return JSON.parse(line) as T;
      } catch (err) {
        throw new Error(`${path} line ${n}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
      }
    });
}

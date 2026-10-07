/**
 * Judging for offline evals (calibration, golden runs) on top of the
 * production judge call (judgeBands): several votes per band with the median
 * per dimension, a different band order per vote, and optionally one call per
 * band instead of one batch.
 *
 * Why: judges at temperature 0 are still noisy (Radiationsafety saw 46–62% on
 * the same answers), LLM judges favour list positions (MT-Bench, Gu 2025), and
 * weaker judges score better with one item per call (GroUSE, Muller 2024).
 */
import type { ChatModelClient } from "../api/src/agent/modelUtils.js";
import { judgeBands, type JudgeInput, type JudgeScoreObject } from "../api/src/eval/judgeWorker.js";
import { seededShuffle } from "./random.ts";

export type JudgeMode = "batch" | "per-band";

export type JudgeOptions = {
  /** Calls per band; the median of the votes counts. */
  votes?: number;
  mode?: JudgeMode;
  /** Seeds the band shuffles, so a run is reproducible. */
  seed?: number;
  timeoutMs?: number;
};

export type NumericScores = {
  relevance?: number;
  obscurity_fit?: number;
  evidence_quality?: number;
  discovery_value?: number;
};

const DIMENSIONS = ["relevance", "obscurity_fit", "evidence_quality", "discovery_value"] as const;

/** Offline evals may wait on a reasoning judge; the live worker has its own limit. */
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
/** Parallel calls in per-band mode, to stay polite to the provider. */
const PER_BAND_CONCURRENCY = 4;

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return results;
}

/** One vote: every band scored once, in batch or one call per band. */
async function oneVote(
  judgeModel: ChatModelClient,
  bands: JudgeInput[],
  mode: JudgeMode,
  timeoutMs: number,
): Promise<{ scores: Record<string, JudgeScoreObject>; calls: number; failed: number }> {
  if (mode === "batch") {
    const { scores } = await judgeBands(judgeModel, bands, timeoutMs);
    return { scores, calls: 1, failed: 0 };
  }
  const outcomes = await inBatches(bands, PER_BAND_CONCURRENCY, async (band) => {
    try {
      return { ok: true as const, scores: (await judgeBands(judgeModel, [band], timeoutMs)).scores };
    } catch (error) {
      return { ok: false as const, error };
    }
  });
  const failures = outcomes.filter((o) => !o.ok);
  if (failures.length === outcomes.length) throw (failures[0] as { error: unknown }).error;
  const scores = Object.assign({}, ...outcomes.filter((o) => o.ok).map((o) => (o as { scores: object }).scores));
  return { scores, calls: outcomes.length, failed: failures.length };
}

export async function judgeWithVotes(
  judgeModel: ChatModelClient,
  bands: JudgeInput[],
  { votes = 1, mode = "batch", seed = 1, timeoutMs = DEFAULT_TIMEOUT_MS }: JudgeOptions = {},
): Promise<{ scores: Record<string, NumericScores>; callsMade: number; failedCalls: number }> {
  const ballots: Array<Record<string, JudgeScoreObject>> = [];
  let callsMade = 0;
  let failedCalls = 0;
  let lastError: unknown;

  for (let vote = 0; vote < Math.max(1, votes); vote += 1) {
    // The first vote keeps the given order; later ones are shuffled.
    const ordered = vote === 0 ? bands : seededShuffle(bands, seed + vote);
    try {
      const result = await oneVote(judgeModel, ordered, mode, timeoutMs);
      ballots.push(result.scores);
      callsMade += result.calls;
      failedCalls += result.failed;
    } catch (error) {
      lastError = error;
      callsMade += mode === "batch" ? 1 : bands.length;
      failedCalls += mode === "batch" ? 1 : bands.length;
    }
  }
  if (ballots.length === 0) throw lastError instanceof Error ? lastError : new Error(String(lastError));

  const scores: Record<string, NumericScores> = {};
  for (const { bandName } of bands) {
    const combined: NumericScores = {};
    for (const dimension of DIMENSIONS) {
      const values = ballots
        .map((ballot) => ballot[bandName]?.[dimension])
        .filter((v): v is number => typeof v === "number");
      const value = median(values);
      if (value !== undefined) combined[dimension] = value;
    }
    scores[bandName] = combined;
  }
  return { scores, callsMade, failedCalls };
}

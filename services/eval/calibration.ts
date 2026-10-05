import { createHash } from "node:crypto";

import type { ChatModelClient } from "../api/src/agent/modelUtils.js";
import {
  computeAgreementRate,
  runUnitTests,
  type AgreementResult,
  type CalibrationJudgeScore,
  type UnitTestResult,
} from "../api/src/eval/judgeCalibration.js";
import { buildJudgePrompt, judgeBands, type JudgeInput, type JudgeScoreObject } from "../api/src/eval/judgeWorker.js";
import type { GitState } from "./history.ts";

/** One hand-labelled recommendation in judge-calibration.json. */
export type CalibrationEntry = {
  query: string;
  obscurityTarget?: string;
  bandName: string;
  whyText: string;
  sourceSignals: string[];
  listeners: number;
  humanScores: { relevance: number; obscurityFit: number; evidenceQuality: number };
};

/** One directional GroUSE-style case in judge-unit-tests.json. */
export type UnitTestEntry = {
  id: string;
  description: string;
  input: JudgeInput;
  expectedDirection: {
    evidenceQuality?: "low" | "high";
    obscurityFit?: "low" | "high";
    relevance?: "low" | "high";
    discoveryValue?: "low" | "high";
  };
};

export type CalibrationResult = {
  agreement: AgreementResult;
  unitTests: UnitTestResult;
};

/**
 * Generous on purpose: a whole labelled set goes out in one call, and a
 * reasoning judge can think for minutes. Calibration is offline.
 */
const CALIBRATION_TIMEOUT_MS = 10 * 60_000;

function toCalibrationScore(bandName: string, raw: JudgeScoreObject | undefined): CalibrationJudgeScore {
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    bandName,
    relevance: num(raw?.relevance),
    obscurityFit: num(raw?.obscurity_fit),
    evidenceQuality: num(raw?.evidence_quality),
    discoveryValue: num(raw?.discovery_value),
  };
}

/**
 * Scores the labelled set and the unit tests with `judgeModel` through
 * judgeBands, the call production uses, so a calibration result describes the
 * judge that actually scores live traffic. A judge that cannot answer throws.
 */
export async function runCalibration({
  judgeModel,
  calibrationEntries,
  unitTestEntries,
}: {
  judgeModel: ChatModelClient;
  calibrationEntries: CalibrationEntry[];
  unitTestEntries: UnitTestEntry[];
}): Promise<CalibrationResult> {
  const labelled = await judgeBands(
    judgeModel,
    calibrationEntries.map((e) => ({
      bandName: e.bandName,
      query: e.query,
      obscurityTarget: e.obscurityTarget ?? null,
      why: e.whyText,
      sourceSignals: e.sourceSignals,
      listeners: e.listeners,
    })),
    CALIBRATION_TIMEOUT_MS,
  );
  const agreement = computeAgreementRate(
    calibrationEntries.map((e) => ({ bandName: e.bandName, humanScores: e.humanScores })),
    calibrationEntries.map((e) => toCalibrationScore(e.bandName, labelled.scores[e.bandName])),
  );

  const directional = await judgeBands(
    judgeModel,
    unitTestEntries.map((e) => ({ ...e.input, obscurityTarget: e.input.obscurityTarget ?? null })),
    CALIBRATION_TIMEOUT_MS,
  );
  const unitTests = runUnitTests(
    unitTestEntries.map((e) => ({
      id: e.id,
      description: e.description,
      bandName: e.input.bandName,
      expectedDirection: e.expectedDirection,
    })),
    unitTestEntries.map((e) => toCalibrationScore(e.input.bandName, directional.scores[e.input.bandName])),
  );

  return { agreement, unitTests };
}

/** One line of `history/judge-runs.jsonl`. */
export type JudgeRunRecord = {
  schema: 1;
  runId: string;
  timestamp: string;
  label: string | null;
  git: GitState | null;
  dataset: { labelledHash: string; unitTestsHash: string; nLabelled: number; nUnitTests: number };
  config: {
    judgeModel: string;
    /** Changes when the judge's instructions change; runs on different prompts are not comparable. */
    promptHash: string;
  };
  summary: {
    agreementRate: number;
    agreementByDimension: AgreementResult["perDimension"];
    unitTestPassRate: number;
  };
  unitTestFailures: UnitTestResult["failures"];
};

function shortHash(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex").slice(0, 12);
}

export function buildJudgeRunRecord(
  result: CalibrationResult,
  meta: {
    judgeModel: string;
    startedAt: Date;
    label: string | null;
    git: GitState | null;
    calibrationEntries: CalibrationEntry[];
    unitTestEntries: UnitTestEntry[];
  },
): JudgeRunRecord {
  const iso = meta.startedAt.toISOString();
  return {
    schema: 1,
    runId: `${iso.slice(0, 10).replaceAll("-", "")}_${iso.slice(11, 19).replaceAll(":", "")}`,
    timestamp: iso,
    label: meta.label,
    git: meta.git,
    dataset: {
      labelledHash: shortHash(meta.calibrationEntries),
      unitTestsHash: shortHash(meta.unitTestEntries),
      nLabelled: meta.calibrationEntries.length,
      nUnitTests: meta.unitTestEntries.length,
    },
    config: { judgeModel: meta.judgeModel, promptHash: shortHash(buildJudgePrompt([]).system) },
    summary: {
      agreementRate: result.agreement.rate,
      agreementByDimension: result.agreement.perDimension,
      unitTestPassRate: result.unitTests.passRate,
    },
    unitTestFailures: result.unitTests.failures,
  };
}

/**
 * Checks the judge against human labels before its scores are trusted.
 *
 *     npm run calibrate -w services/eval [-- --judge <scaleway-model> ...] [--label NAME]
 *
 * Uses the production judge (config/models.ts, judgeWorker.ts): Scaleway, the
 * model from SCW_JUDGE_MODEL unless --judge names others to compare. Each run
 * is appended to history/judge-runs.jsonl.
 */
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { resolveLlmConfig } from "../api/src/config/models.js";
import { judgeModelFor } from "../api/src/eval/judgeWorker.js";
import {
  buildJudgeRunRecord,
  runCalibration,
  type CalibrationEntry,
  type UnitTestEntry,
} from "./calibration.ts";
import { appendRun, readGitState } from "./history.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const JUDGE_HISTORY_PATH = join(__dirname, "history", "judge-runs.jsonl");

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

async function main(): Promise<void> {
  loadEnv({ path: join(__dirname, "../../.env"), quiet: true });
  const { values: args } = parseArgs({
    options: {
      judge: { type: "string", multiple: true },
      votes: { type: "string" },
      mode: { type: "string" },
      label: { type: "string" },
      "no-history": { type: "boolean", default: false },
      "allow-dirty": { type: "boolean", default: false },
    },
  });

  const llm = resolveLlmConfig(process.env);
  if (!llm.judge) {
    console.error("No judge configured: set SCW_SECRET_KEY (and optionally SCW_JUDGE_MODEL).");
    process.exit(1);
  }
  const recordHistory = !args["no-history"];
  const git = readGitState([JUDGE_HISTORY_PATH]);
  if (recordHistory && git?.dirty && !args["allow-dirty"]) {
    console.error("Tracked files have uncommitted changes; commit first, or pass --allow-dirty or --no-history.");
    process.exit(2);
  }

  const calibrationEntries: CalibrationEntry[] = JSON.parse(readFileSync(join(__dirname, "judge-calibration.json"), "utf8"));
  const unitTestEntries: UnitTestEntry[] = JSON.parse(readFileSync(join(__dirname, "judge-unit-tests.json"), "utf8"));
  // --judge model[:reasoning], e.g. gpt-oss-120b:low (that model cannot turn reasoning off).
  const judges = (args.judge?.length ? args.judge : [`${llm.judge.model}:${llm.judge.reasoningEffort ?? "none"}`]).map((spec) => {
    const [model, effort] = spec.split(":");
    return { model: model!, reasoningEffort: effort || "none" };
  });
  const votes = Math.max(1, Number.parseInt(args.votes ?? "1", 10) || 1);
  const mode = args.mode === "per-band" ? "per-band" : "batch";

  let worst = 1;
  for (const { model, reasoningEffort } of judges) {
    const judgeModel = judgeModelFor({ ...llm, judge: { provider: "scaleway", model, reasoningEffort } })!;
    console.log(
      `\nJudge ${model} (reasoning ${reasoningEffort}, ${votes} vote(s), ${mode}): ` +
        `${calibrationEntries.length} labelled examples, ${unitTestEntries.length} unit tests…`,
    );
    const startedAt = new Date();
    let result;
    try {
      result = await runCalibration({ judgeModel, calibrationEntries, unitTestEntries, judging: { votes, mode } });
    } catch (error) {
      // One unusable candidate must not stop the comparison of the others.
      console.error(`  ✗ ${model} could not be calibrated: ${error instanceof Error ? error.message : String(error)}`);
      worst = 0;
      continue;
    }

    const { perDimension, rate } = result.agreement;
    console.log(
      `  agreement ${pct(rate)}  (relevance ${pct(perDimension.relevance)}, obscurityFit ${pct(perDimension.obscurityFit)}, ` +
        `evidenceQuality ${pct(perDimension.evidenceQuality)})  ·  unit tests ${pct(result.unitTests.passRate)}  ·  ` +
        `${((Date.now() - startedAt.getTime()) / 1000).toFixed(0)} s` +
        (result.judging.failedCalls ? `  ·  ${result.judging.failedCalls} failed call(s) left out` : ""),
    );
    for (const f of result.unitTests.failures) {
      console.log(`  ✗ [${f.id}] ${f.dimension}: expected ${f.expected}, got ${f.actual ?? "no score"} — ${f.description}`);
    }

    if (recordHistory) {
      appendRun(
        JUDGE_HISTORY_PATH,
        buildJudgeRunRecord(result, {
          judgeModel: model,
          reasoningEffort,
          startedAt,
          label: args.label ?? null,
          git,
          calibrationEntries,
          unitTestEntries,
        }),
      );
    }
    worst = Math.min(worst, rate);
  }

  if (recordHistory) console.log(`\nRecorded in ${JUDGE_HISTORY_PATH}`);
  // Below 60% a judge is not trustworthy; 60–80% is usable with care.
  if (worst < 0.6) {
    console.error("FAIL: a judge agrees with the human labels less than 60% of the time.");
    process.exit(1);
  }
  if (worst < 0.8) console.warn("WARN: a judge agrees with the human labels less than 80% of the time.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error("Calibration failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

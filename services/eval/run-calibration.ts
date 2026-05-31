import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  computeAgreementRate,
  runUnitTests,
  type HumanLabel,
  type CalibrationJudgeScore,
  type UnitTestCase,
} from "../api/src/eval/judgeCalibration.js";
import { buildJudgePrompt, type JudgeInput } from "../api/src/eval/judgeWorker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

type CalibrationEntry = {
  query: string;
  obscurityTarget?: string;
  bandName: string;
  whyText: string;
  sourceSignals: string[];
  listeners: number;
  humanScores: { relevance: number; obscurityFit: number; evidenceQuality: number };
};

type UnitTestEntry = {
  id: string;
  description: string;
  input: JudgeInput;
  expectedDirection: { evidenceQuality?: "low" | "high"; obscurityFit?: "low" | "high"; relevance?: "low" | "high"; discoveryValue?: "low" | "high" };
};

async function callJudge(
  bands: JudgeInput[],
  apiKey: string,
): Promise<Record<string, { relevance?: number; obscurity_fit?: number; evidence_quality?: number; discovery_value?: number }>> {
  const { system, user } = buildJudgePrompt(bands);

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 8192,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
    const text = data?.content?.find((c) => c.type === "text")?.text ?? "";
    return JSON.parse(text) as Record<string, { relevance?: number; obscurity_fit?: number; evidence_quality?: number; discovery_value?: number }>;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function toCalibrationScore(
  bandName: string,
  raw: { relevance?: number; obscurity_fit?: number; evidence_quality?: number; discovery_value?: number },
): CalibrationJudgeScore {
  return {
    bandName,
    relevance: raw.relevance ?? null,
    obscurityFit: raw.obscurity_fit ?? null,
    evidenceQuality: raw.evidence_quality ?? null,
    discoveryValue: raw.discovery_value ?? null,
  };
}

function printTable(rows: Array<Record<string, string | number>>) {
  if (rows.length === 0) return;
  const keys = Object.keys(rows[0]);
  const widths = keys.map((k) => Math.max(k.length, ...rows.map((r) => String(r[k]).length)));
  const header = keys.map((k, i) => k.padEnd(widths[i])).join("  ");
  const divider = widths.map((w) => "-".repeat(w)).join("  ");
  console.log(header);
  console.log(divider);
  for (const row of rows) {
    console.log(keys.map((k, i) => String(row[k]).padEnd(widths[i])).join("  "));
  }
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is required to run calibration.");
    process.exit(1);
  }

  const calibrationPath = join(__dirname, "judge-calibration.json");
  const unitTestPath = join(__dirname, "judge-unit-tests.json");

  const calibrationEntries: CalibrationEntry[] = JSON.parse(await readFile(calibrationPath, "utf8"));
  const unitTestEntries: UnitTestEntry[] = JSON.parse(await readFile(unitTestPath, "utf8"));

  // --- Calibration: call judge for all entries ---
  console.log(`\nRunning judge calibration on ${calibrationEntries.length} labeled samples…`);

  const calibrationInputs: JudgeInput[] = calibrationEntries.map((e) => ({
    bandName: e.bandName,
    query: e.query,
    obscurityTarget: e.obscurityTarget ?? null,
    why: e.whyText,
    sourceSignals: e.sourceSignals,
    listeners: e.listeners,
    citationSupportRate: undefined,
    genericWhyFlag: undefined,
  }));

  const calibrationRaw = await callJudge(calibrationInputs, apiKey);
  const judgeScores: CalibrationJudgeScore[] = calibrationEntries.map((e) =>
    toCalibrationScore(e.bandName, calibrationRaw[e.bandName] ?? {}),
  );

  const humanLabels: HumanLabel[] = calibrationEntries.map((e) => ({
    bandName: e.bandName,
    humanScores: e.humanScores,
  }));

  const agreementResult = computeAgreementRate(humanLabels, judgeScores);

  console.log("\n=== Calibration Results ===");
  printTable([
    {
      Dimension: "relevance",
      "Agreement Rate": `${(agreementResult.perDimension.relevance * 100).toFixed(1)}%`,
    },
    {
      Dimension: "obscurityFit",
      "Agreement Rate": `${(agreementResult.perDimension.obscurityFit * 100).toFixed(1)}%`,
    },
    {
      Dimension: "evidenceQuality",
      "Agreement Rate": `${(agreementResult.perDimension.evidenceQuality * 100).toFixed(1)}%`,
    },
    {
      Dimension: "OVERALL",
      "Agreement Rate": `${(agreementResult.rate * 100).toFixed(1)}%`,
    },
  ]);

  // --- Unit tests: call judge for all inputs ---
  console.log(`\nRunning ${unitTestEntries.length} GroUSE-style unit tests…`);

  const unitTestInputs: JudgeInput[] = unitTestEntries.map((e) => ({
    ...e.input,
    obscurityTarget: e.input.obscurityTarget ?? null,
  }));

  const unitTestRaw = await callJudge(unitTestInputs, apiKey);
  const unitTestScores: CalibrationJudgeScore[] = unitTestEntries.map((e) =>
    toCalibrationScore(e.input.bandName, unitTestRaw[e.input.bandName] ?? {}),
  );

  const unitTestCases: UnitTestCase[] = unitTestEntries.map((e) => ({
    id: e.id,
    description: e.description,
    bandName: e.input.bandName,
    expectedDirection: e.expectedDirection,
  }));

  const unitTestResult = runUnitTests(unitTestCases, unitTestScores);

  console.log(`\n=== Unit Test Results: ${(unitTestResult.passRate * 100).toFixed(1)}% pass rate ===`);
  if (unitTestResult.failures.length > 0) {
    console.log("\nFailures:");
    for (const f of unitTestResult.failures) {
      console.log(`  [${f.id}] ${f.description}`);
      console.log(`    dimension=${f.dimension}, expected=${f.expected}, actual=${f.actual ?? "null"}`);
    }
  } else {
    console.log("All unit tests passed.");
  }

  // --- Exit logic ---
  const overallRate = agreementResult.rate;
  if (overallRate < 0.6) {
    console.error(`\nFAIL: Judge–human agreement ${(overallRate * 100).toFixed(1)}% is below the 60% hard threshold. Judge is not trustworthy.`);
    process.exit(1);
  }
  if (overallRate < 0.8) {
    console.warn(`\nWARN: Judge–human agreement ${(overallRate * 100).toFixed(1)}% is below the 80% advisory threshold. Review calibration data.`);
  } else {
    console.log(`\nOK: Judge–human agreement ${(overallRate * 100).toFixed(1)}% meets the 80% threshold.`);
  }
}

main().catch((err) => {
  console.error("Calibration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

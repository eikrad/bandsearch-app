import { test } from "node:test";
import assert from "node:assert/strict";

import type { ChatModelClient } from "../api/src/agent/modelUtils.js";
import {
  buildJudgeRunRecord,
  runCalibration,
  type CalibrationEntry,
  type UnitTestEntry,
} from "./calibration.ts";

const calibrationEntries: CalibrationEntry[] = [
  {
    query: "atmospheric black metal",
    obscurityTarget: "underground",
    bandName: "Fen",
    whyText: "Post-black metal from the fens, see https://bandcamp.example/fen",
    sourceSignals: ["https://bandcamp.example/fen"],
    listeners: 40000,
    humanScores: { relevance: 0.9, obscurityFit: 0.8, evidenceQuality: 0.8 },
  },
  {
    query: "atmospheric black metal",
    obscurityTarget: "underground",
    bandName: "Coldplay",
    whyText: "A great band.",
    sourceSignals: [],
    listeners: 9000000,
    humanScores: { relevance: 0.1, obscurityFit: 0.1, evidenceQuality: 0.1 },
  },
];

const unitTestEntries: UnitTestEntry[] = [
  {
    id: "ut-01",
    description: "uncited claim → evidenceQuality low",
    input: { bandName: "Phantom Band", query: "post-rock", why: "Trust me.", sourceSignals: [] },
    expectedDirection: { evidenceQuality: "low" },
  },
];

/** A judge that answers each prompt with scores for exactly the bands it was sent. */
function judgeAnswering(scores: Record<string, Record<string, number>>, prompts: string[] = []): ChatModelClient {
  return {
    async invoke(prompt) {
      const user = prompt.find((m) => m.role === "user")?.content ?? "";
      prompts.push(user);
      const sent = (JSON.parse(user) as Array<{ band_name: string }>).map((b) => b.band_name);
      return { content: JSON.stringify(Object.fromEntries(sent.map((name) => [name, scores[name] ?? {}]))) };
    },
  };
}

const agreeingScores = {
  Fen: { relevance: 0.9, obscurity_fit: 0.7, evidence_quality: 0.9, discovery_value: 0.8 },
  Coldplay: { relevance: 0.2, obscurity_fit: 0.0, evidence_quality: 0.1, discovery_value: 0.1 },
  "Phantom Band": { relevance: 0.5, obscurity_fit: 0.5, evidence_quality: 0.1, discovery_value: 0.5 },
};

test("calibration measures how often the judge agrees with the human labels", async () => {
  const result = await runCalibration({
    judgeModel: judgeAnswering(agreeingScores),
    calibrationEntries,
    unitTestEntries,
  });

  assert.equal(result.agreement.rate, 1);
  assert.deepEqual(result.agreement.perDimension, { relevance: 1, obscurityFit: 1, evidenceQuality: 1 });
});

test("calibration runs the directional unit tests and names the ones the judge gets wrong", async () => {
  const result = await runCalibration({
    judgeModel: judgeAnswering({
      ...agreeingScores,
      "Phantom Band": { relevance: 0.5, obscurity_fit: 0.5, evidence_quality: 0.9, discovery_value: 0.5 },
    }),
    calibrationEntries,
    unitTestEntries,
  });

  assert.equal(result.unitTests.passRate, 0);
  assert.deepEqual(result.unitTests.failures.map((f) => f.id), ["ut-01"]);
});

test("calibration sends the labelled examples the same way production sends recommendations", async () => {
  const prompts: string[] = [];
  await runCalibration({ judgeModel: judgeAnswering(agreeingScores, prompts), calibrationEntries, unitTestEntries });

  assert.equal(prompts.length, 2, "one call for the labelled set, one for the unit tests");
  const sent = JSON.parse(prompts[0]!) as Array<Record<string, unknown>>;
  assert.equal(sent[0]!.band_name, "Fen");
  assert.equal(sent[0]!.why, "Post-black metal from the fens, see https://bandcamp.example/fen");
});

test("a judge that cannot answer fails the calibration instead of scoring zero agreement", async () => {
  const broken: ChatModelClient = { invoke: async () => ({ content: "no json here" }) };
  await assert.rejects(runCalibration({ judgeModel: broken, calibrationEntries, unitTestEntries }));
});

test("a calibration record names the judge model, the prompt and the data it was scored on", async () => {
  const result = await runCalibration({ judgeModel: judgeAnswering(agreeingScores), calibrationEntries, unitTestEntries });

  const record = buildJudgeRunRecord(result, {
    judgeModel: "mistral-medium-3.5-128b",
    startedAt: new Date("2026-10-05T12:00:00Z"),
    label: "judge-candidate",
    git: { commit: "abc1234", branch: "feature", dirty: false },
    calibrationEntries,
    unitTestEntries,
  });

  assert.equal(record.runId, "20261005_120000");
  assert.equal(record.config.judgeModel, "mistral-medium-3.5-128b");
  assert.match(record.config.promptHash, /^[0-9a-f]{12}$/);
  assert.equal(record.dataset.nLabelled, 2);
  assert.equal(record.dataset.nUnitTests, 1);
  assert.equal(record.summary.agreementRate, 1);
  assert.equal(record.summary.unitTestPassRate, 1);
});

test("a calibration can use several votes and per-band calls, and records how it judged", async () => {
  const prompts: string[] = [];
  const result = await runCalibration({
    judgeModel: judgeAnswering(agreeingScores, prompts),
    calibrationEntries,
    unitTestEntries,
    judging: { votes: 3, mode: "per-band" },
  });
  assert.equal(prompts.length, 3 * (calibrationEntries.length + unitTestEntries.length));

  const record = buildJudgeRunRecord(result, {
    judgeModel: "gpt-oss-120b",
    reasoningEffort: "low",
    startedAt: new Date("2026-10-05T12:00:00Z"),
    label: null,
    git: null,
    calibrationEntries,
    unitTestEntries,
  });
  assert.deepEqual(
    { votes: record.config.votes, mode: record.config.mode, reasoningEffort: record.config.reasoningEffort },
    { votes: 3, mode: "per-band", reasoningEffort: "low" },
  );
  assert.equal(record.summary.failedCalls, 0);
});

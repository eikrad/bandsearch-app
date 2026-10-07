import { test } from "node:test";
import assert from "node:assert/strict";

import type { ChatModelClient } from "../api/src/agent/modelUtils.js";
import type { JudgeInput } from "../api/src/eval/judgeWorker.js";
import { judgeWithVotes } from "./judging.ts";

const bands: JudgeInput[] = ["Fen", "Ghost Bath", "Coldplay"].map((bandName) => ({ bandName, query: "blackgaze" }));

type Call = string[];

/**
 * A judge whose answer for each band comes from `scoreFor(band, call)`, and
 * which records the band order of every call it receives.
 */
function scriptedJudge(scoreFor: (band: string, call: number) => number | Error, calls: Call[] = []): ChatModelClient {
  return {
    async invoke(prompt) {
      const user = prompt.find((m) => m.role === "user")?.content ?? "[]";
      const sent = (JSON.parse(user) as Array<{ band_name: string }>).map((b) => b.band_name);
      const call = calls.length;
      calls.push(sent);
      const answer: Record<string, unknown> = {};
      for (const band of sent) {
        const score = scoreFor(band, call);
        if (score instanceof Error) throw score;
        answer[band] = { relevance: score, obscurity_fit: score, evidence_quality: score, discovery_value: score };
      }
      return { content: JSON.stringify(answer) };
    },
  };
}

test("one vote in batch mode is a single call with every band", async () => {
  const calls: Call[] = [];
  const result = await judgeWithVotes(scriptedJudge(() => 0.8, calls), bands);

  assert.equal(calls.length, 1);
  assert.equal(result.scores.Fen!.relevance, 0.8);
  assert.equal(result.callsMade, 1);
});

test("several votes take the median per band and dimension", async () => {
  const perCall = [0.2, 0.9, 0.7];
  const result = await judgeWithVotes(scriptedJudge((_band, call) => perCall[call]!), bands, { votes: 3 });

  assert.equal(result.scores["Ghost Bath"]!.relevance, 0.7, "median of 0.2, 0.9, 0.7");
});

test("each vote sees the bands in a different order, so position bias averages out", async () => {
  const calls: Call[] = [];
  await judgeWithVotes(scriptedJudge(() => 0.5, calls), bands, { votes: 3 });

  const orders = new Set(calls.map((c) => c.join("|")));
  assert.ok(orders.size > 1, `expected shuffled orders, got ${[...orders].join(" / ")}`);
  for (const call of calls) assert.deepEqual([...call].sort(), ["Coldplay", "Fen", "Ghost Bath"]);
});

test("the band order is reproducible for the same seed", async () => {
  const first: Call[] = [];
  const second: Call[] = [];
  await judgeWithVotes(scriptedJudge(() => 0.5, first), bands, { votes: 3, seed: 7 });
  await judgeWithVotes(scriptedJudge(() => 0.5, second), bands, { votes: 3, seed: 7 });
  assert.deepEqual(first, second);
});

test("per-band mode judges each band in its own call", async () => {
  const calls: Call[] = [];
  const result = await judgeWithVotes(scriptedJudge(() => 0.6, calls), bands, { mode: "per-band" });

  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.length === 1));
  assert.equal(result.scores.Coldplay!.evidence_quality, 0.6);
});

test("a failed vote is left out as long as another vote succeeds", async () => {
  const result = await judgeWithVotes(
    scriptedJudge((_band, call) => (call === 1 ? new Error("timeout") : 0.4)),
    bands,
    { votes: 3 },
  );
  assert.equal(result.scores.Fen!.relevance, 0.4);
  assert.equal(result.failedCalls, 1);
});

test("when every vote fails the judging fails, instead of returning no scores", async () => {
  await assert.rejects(judgeWithVotes(scriptedJudge(() => new Error("down")), bands, { votes: 2 }), /down/);
});

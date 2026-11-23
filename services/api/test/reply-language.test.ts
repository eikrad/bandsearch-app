import test from "node:test";
import assert from "node:assert/strict";

import { REPLY_LANGUAGE_RULE, REPLY_LANGUAGE_JUDGE_RULE } from "../src/replyLanguage.js";
import { createRecommendationRanker } from "../src/agent/research/recommendationRanker.js";
import { writeAnswer } from "../src/agent/conversation/answerWriter.js";
import { buildJudgePrompt } from "../src/eval/judgeWorker.js";
import type { ChatModelClient } from "../src/agent/modelUtils.js";

/**
 * The reply language rule (#329): every text the user reads follows the
 * language of their newest message. It has one home, `replyLanguage.ts`; the
 * two prompts that write user-facing text and the judge that scores it all
 * read it from there, so the eval measures the rule the search follows.
 */

function recordingModel(reply: string): { client: ChatModelClient; systems: string[] } {
  const systems: string[] = [];
  return {
    systems,
    client: {
      async invoke(prompt) {
        systems.push(prompt.filter((p) => p.role === "system").map((p) => p.content).join("\n"));
        return { content: reply };
      },
    },
  };
}

test("the rule asks for the language of the user's newest message, not of the app", () => {
  assert.match(REPLY_LANGUAGE_RULE, /language of the user's newest message/);
  assert.match(REPLY_LANGUAGE_RULE, /band names/i, "names stay as they are");
});

test("the ranker tells the model to write the reply and every why in the user's language", async () => {
  const { client, systems } = recordingModel(JSON.stringify({ reply: "Hier.", recommendations: [] }));
  const rank = await createRecommendationRanker({ modelClient: client });
  await rank({ query: "Bands wie Alcest", preferenceContext: "", messages: [], mode: "fresh", candidates: [] }).catch(() => {});
  assert.ok(systems.length > 0, "the ranker asked the model");
  assert.ok(systems[0]!.includes(REPLY_LANGUAGE_RULE));
});

test("an answer in words follows the same rule", async () => {
  const { client, systems } = recordingModel("Gerne!");
  await writeAnswer(client, { query: "Danke!", messages: [], shown: [] }, { timeoutMs: 5000 });
  assert.ok(systems[0]!.includes(REPLY_LANGUAGE_RULE));
});

test("the judge counts a why in another language than the query against its evidence quality", () => {
  const { system } = buildJudgePrompt([
    { bandName: "Fen", query: "Bands wie Alcest", why: "Post-black metal from England.", sourceSignals: [] },
  ]);
  assert.ok(system.includes(REPLY_LANGUAGE_JUDGE_RULE));
  assert.match(REPLY_LANGUAGE_JUDGE_RULE, /evidence_quality/);
});

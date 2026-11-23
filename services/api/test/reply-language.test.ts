import test from "node:test";
import assert from "node:assert/strict";

import {
  KEPT_AS_IS,
  REPLY_LANGUAGE_EVIDENCE_CAP,
  REPLY_LANGUAGE_RULE,
  REPLY_LANGUAGE_JUDGE_RULE,
} from "../src/replyLanguage.js";
import { createRecommendationRanker } from "../src/agent/research/recommendationRanker.js";
import { writeAnswer } from "../src/agent/conversation/answerWriter.js";
import { buildJudgePrompt, judgeBands } from "../src/eval/judgeWorker.js";
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

test("the judge names the query's and the why's language and whether they match", () => {
  const { system } = buildJudgePrompt([
    { bandName: "Fen", query: "Bands wie Alcest", why: "Post-black metal from England.", sourceSignals: [] },
  ]);
  assert.ok(system.includes(REPLY_LANGUAGE_JUDGE_RULE));
  for (const field of ["query_language", "why_language", "why_in_query_language"]) {
    assert.ok(system.includes(`"${field}"`), `the answer format asks for ${field}`);
  }
});

// gemma-4-26b names both languages correctly but then scores a German query's
// English why 1.0 anyway (probe of 2026-11-23). It reports the mismatch; the
// cap is applied here, by the rule's one home, not left to the model.
function judgeAnswering(score: Record<string, unknown>): ChatModelClient {
  return { async invoke() { return { content: JSON.stringify({ Fen: score }) }; } };
}
const fen = [{ bandName: "Fen", query: "Bands wie Alcest", why: "Post-black metal from England.", sourceSignals: [] }];

test("a why the judge finds in another language than the query is capped on evidence quality", async () => {
  const { scores } = await judgeBands(judgeAnswering({ evidence_quality: 1, why_in_query_language: false }), fen);
  assert.equal(scores.Fen!.evidence_quality, REPLY_LANGUAGE_EVIDENCE_CAP);
});

test("a why in the query's language keeps the judge's evidence score", async () => {
  const { scores } = await judgeBands(judgeAnswering({ evidence_quality: 0.9, why_in_query_language: true }), fen);
  assert.equal(scores.Fen!.evidence_quality, 0.9);
});

test("a judge that does not say whether the languages match is taken at its score", async () => {
  const { scores } = await judgeBands(judgeAnswering({ evidence_quality: 0.9 }), fen);
  assert.equal(scores.Fen!.evidence_quality, 0.9);
});

test("the cap only lowers: a weak why in another language stays as weak as the judge scored it", async () => {
  const { scores } = await judgeBands(judgeAnswering({ evidence_quality: 0.1, why_in_query_language: false }), fen);
  assert.equal(scores.Fen!.evidence_quality, 0.1);
});

test("the search and the judge exempt the same text from the rule, verbatim quotes included", () => {
  // The baseline of 2026-11-23 scored Danish answers 0.3 on evidence: their whys
  // quote an English source word for word, as the ranker asks, and the judge
  // counted the quote as another language.
  assert.match(KEPT_AS_IS, /quoted word for word/);
  assert.ok(REPLY_LANGUAGE_RULE.includes(KEPT_AS_IS), "the search keeps quotes as they are");
  assert.ok(REPLY_LANGUAGE_JUDGE_RULE.includes(KEPT_AS_IS), "the judge does not count them against the why");
});

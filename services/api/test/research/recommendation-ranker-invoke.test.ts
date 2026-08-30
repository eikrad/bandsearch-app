import test from "node:test";
import assert from "node:assert/strict";

import { createRecommendationRanker } from "../../src/agent/research/recommendationRanker.js";
import type { ChatModelClient } from "../../src/agent/modelUtils.js";
import type { VerifiedCandidate } from "../../src/agent/research/candidateVerifier.js";

/**
 * The closure `createRecommendationRanker` returns.
 *
 * recommendation-ranker.test.ts covers the exported pure helpers; the `rank`
 * body was untested, and with it the citation-retry path — when the model
 * returns recommendations whose `why` cites no evidence URL, the ranker
 * re-prompts and re-parses. That is a real product behaviour with a real
 * failure mode, and nothing exercised it.
 */

const EVIDENCE_URL = "https://blog.example/ffo-alcest";

const candidates: VerifiedCandidate[] = [
  {
    name: "Fen",
    evidenceUrls: [EVIDENCE_URL],
    evidenceSnippets: ["Fen are underrated"],
    sourceQueries: ["ffo alcest"],
    verified: true,
    canonicalName: "Fen",
    mbid: "mbid-fen",
  },
];

const rankInput = {
  query: "bands like Alcest",
  preferenceContext: "",
  messages: [],
  mode: "fresh" as const,
  candidates,
};

/** A model that replies with each scripted payload in turn. */
function scriptedModel(payloads: unknown[]): { client: ChatModelClient; prompts: string[][] } {
  const prompts: string[][] = [];
  const queue = [...payloads];
  return {
    prompts,
    client: {
      async invoke(prompt) {
        prompts.push(prompt.map((p) => p.content));
        const next = queue.shift();
        if (next === undefined) throw new Error("model called more times than scripted");
        return { content: typeof next === "string" ? next : JSON.stringify(next) };
      },
    },
  };
}

const withCitation = {
  reply: "Here are picks.",
  recommendations: [{ artist: "Fen", why: `Post-black, see ${EVIDENCE_URL}`, sourceSignals: [] }],
};

const withoutCitation = {
  reply: "Here are picks.",
  recommendations: [{ artist: "Fen", why: "They are good.", sourceSignals: [] }],
};

/**
 * An artist that appears in no candidate, so it cannot be attributed at all.
 * This — not a missing URL on a known artist — is what empties the list and
 * triggers the retry.
 */
const unattributable = {
  reply: "Here are picks.",
  recommendations: [{ artist: "Invented Band", why: "They are good.", sourceSignals: [] }],
};

// ------------------------------------------------------------ happy path

test("rank returns the model's recommendations and reply", async () => {
  const { client } = scriptedModel([withCitation]);
  const rank = await createRecommendationRanker({ apiKey: "", modelClient: client });

  const result = await rank(rankInput);

  assert.equal(result.recommendations.length, 1);
  assert.equal((result.recommendations[0] as { artist: string }).artist, "Fen");
  assert.equal(result.assistantReply, "Here are picks.");
});

test("rank accepts a bare array of recommendations", async () => {
  const { client } = scriptedModel([
    [{ artist: "Fen", why: `See ${EVIDENCE_URL}`, sourceSignals: [] }],
  ]);
  const rank = await createRecommendationRanker({ apiKey: "", modelClient: client });

  const result = await rank(rankInput);

  assert.equal(result.recommendations.length, 1);
});

test("rank puts the evidence block in the prompt", async () => {
  const { client, prompts } = scriptedModel([withCitation]);
  const rank = await createRecommendationRanker({ apiKey: "", modelClient: client });

  await rank(rankInput);

  assert.match(prompts[0].join("\n"), /evidence_candidates/);
  assert.match(prompts[0].join("\n"), new RegExp(EVIDENCE_URL.replace(/[/.]/g, "\\$&")));
});

// -------------------------------------------------------- citation retry

test("rank appends the evidence URL when the model omits it", async () => {
  const { client, prompts } = scriptedModel([withoutCitation]);
  const rank = await createRecommendationRanker({ apiKey: "", modelClient: client });

  const result = await rank(rankInput);

  // A known candidate is repaired in place rather than dropped, so no retry.
  assert.equal(prompts.length, 1);
  assert.equal((result.recommendations[0] as { why: string }).why, `They are good. (see ${EVIDENCE_URL})`);
});

test("rank drops a recommendation for an artist with no evidence", async () => {
  const { client } = scriptedModel([
    {
      reply: "Here are picks.",
      recommendations: [
        { artist: "Fen", why: `See ${EVIDENCE_URL}`, sourceSignals: [] },
        { artist: "Invented Band", why: "Trust me.", sourceSignals: [] },
      ],
    },
  ]);
  const rank = await createRecommendationRanker({ apiKey: "", modelClient: client });

  const result = await rank(rankInput);

  assert.equal(result.recommendations.length, 1);
  assert.equal((result.recommendations[0] as { artist: string }).artist, "Fen");
});

test("rank re-prompts when every recommendation was unattributable", async () => {
  const { client, prompts } = scriptedModel([unattributable, withCitation]);
  const rank = await createRecommendationRanker({ apiKey: "", modelClient: client });

  const result = await rank(rankInput);

  assert.equal(prompts.length, 2, "an entirely unattributable answer must trigger exactly one retry");
  assert.match(prompts[1].join("\n"), /omitted required evidence URLs/);
  assert.equal(result.recommendations.length, 1);
});

test("rank returns nothing when the retry is also unattributable", async () => {
  const { client, prompts } = scriptedModel([unattributable, unattributable]);
  const rank = await createRecommendationRanker({ apiKey: "", modelClient: client });

  const result = await rank(rankInput);

  // Better to answer with nothing than with claims the evidence does not back.
  assert.equal(prompts.length, 2, "the ranker must not retry more than once");
  assert.deepEqual(result.recommendations, []);
});

test("rank does not retry when the first answer is already cited", async () => {
  const { client, prompts } = scriptedModel([withCitation]);
  const rank = await createRecommendationRanker({ apiKey: "", modelClient: client });

  await rank(rankInput);

  assert.equal(prompts.length, 1);
});

test("rank tags attributed recommendations with their source signals", async () => {
  const { client } = scriptedModel([withCitation]);
  const rank = await createRecommendationRanker({ apiKey: "", modelClient: client });

  const [first] = await rank(rankInput).then((r) => r.recommendations);
  const row = first as { sourceSignals: string[]; musicbrainzArtistId?: string };

  assert.ok(row.sourceSignals.includes("web_search"));
  assert.ok(row.sourceSignals.includes("musicbrainz_verification"));
  assert.equal(row.musicbrainzArtistId, "mbid-fen");
});

// ------------------------------------------------------- reply fallback

test("rank synthesises a reply when the model omits one", async () => {
  const { client } = scriptedModel([
    { recommendations: [{ artist: "Fen", why: `See ${EVIDENCE_URL}`, sourceSignals: [] }] },
  ]);
  const rank = await createRecommendationRanker({ apiKey: "", modelClient: client });

  const result = await rank(rankInput);

  assert.match(result.assistantReply, /Fen/);
  assert.match(result.assistantReply, /grounded in search evidence/);
});

test("rank leaves the reply empty when there is nothing to recommend", async () => {
  const { client } = scriptedModel([{ recommendations: [] }, { recommendations: [] }]);
  const rank = await createRecommendationRanker({ apiKey: "", modelClient: client });

  const result = await rank(rankInput);

  assert.equal(result.assistantReply, "");
});

test("rank prefers an alternative reply key from the model", async () => {
  const { client } = scriptedModel([
    {
      assistant_reply: "Try these.",
      recommendations: [{ artist: "Fen", why: `See ${EVIDENCE_URL}`, sourceSignals: [] }],
    },
  ]);
  const rank = await createRecommendationRanker({ apiKey: "", modelClient: client });

  assert.equal((await rank(rankInput)).assistantReply, "Try these.");
});

// -------------------------------------------------------- malformed input

test("rank rejects a payload that is not a recommendation shape", async () => {
  const { client } = scriptedModel([{ nonsense: true }]);
  const rank = await createRecommendationRanker({ apiKey: "", modelClient: client });

  await assert.rejects(() => rank(rankInput), /invalid recommendation output/);
});

test("rank rejects recommendations missing a required field", async () => {
  const { client } = scriptedModel([{ recommendations: [{ artist: "Fen" }] }]);
  const rank = await createRecommendationRanker({ apiKey: "", modelClient: client });

  await assert.rejects(() => rank(rankInput), /invalid recommendation output/);
});

test("rank rejects a response that is not JSON at all", async () => {
  const { client } = scriptedModel(["I'm sorry, I can't help with that."]);
  const rank = await createRecommendationRanker({ apiKey: "", modelClient: client });

  await assert.rejects(() => rank(rankInput), /invalid recommendation output/);
});

test("rank parses JSON wrapped in a markdown fence", async () => {
  const { client } = scriptedModel([`\`\`\`json\n${JSON.stringify(withCitation)}\n\`\`\``]);
  const rank = await createRecommendationRanker({ apiKey: "", modelClient: client });

  assert.equal((await rank(rankInput)).recommendations.length, 1);
});

// ---------------------------------------------------------------- config

test("createRecommendationRanker requires an API key when no model is injected", async () => {
  await assert.rejects(
    () => createRecommendationRanker({ apiKey: "  " }),
    /apiKey is required for recommendation ranker/,
  );
});

test("createRecommendationRanker accepts an injected model with no API key", async () => {
  const { client } = scriptedModel([withCitation]);

  assert.ok(typeof (await createRecommendationRanker({ apiKey: "", modelClient: client })) === "function");
});

const test = require("node:test");
const assert = require("node:assert/strict");

const { createRecommendationAgent, createLangChainRunner } = require("../src/agent/recommendationAgent");

test("recommendation agent maps structured model output", async () => {
  const fakeRunner = async ({ query, artists }) => {
    assert.equal(query, "I like Alcest");
    assert.equal(artists.length, 1);
    return [
      {
        artist: "Les Discrets",
        why: "Similar dreamy blackgaze textures.",
        sourceSignals: ["musicbrainz_search", "agent_reasoning"],
      },
    ];
  };

  const agent = createRecommendationAgent({ runModel: fakeRunner });
  const recommendations = await agent.recommend({
    query: "I like Alcest",
    artists: [{ id: "a1", name: "Alcest", score: 99, disambiguation: "" }],
  });

  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].artist, "Les Discrets");
  assert.equal(recommendations[0].sourceSignals[0], "musicbrainz_search");
});

test("recommendation agent forwards preferenceContext to runModel", async () => {
  let capturedArgs;
  const fakeRunner = async (args) => {
    capturedArgs = args;
    return [{ artist: "X", why: "test", sourceSignals: ["musicbrainz_search"] }];
  };

  const agent = createRecommendationAgent({ runModel: fakeRunner });
  await agent.recommend({
    query: "dark ambient",
    artists: [],
    preferenceContext: "saved: Sunn O))) rated 5",
  });

  assert.equal(capturedArgs.preferenceContext, "saved: Sunn O))) rated 5");
});

test("recommendation agent defaults preferenceContext to empty string when omitted", async () => {
  let capturedArgs;
  const fakeRunner = async (args) => {
    capturedArgs = args;
    return [{ artist: "X", why: "test", sourceSignals: ["musicbrainz_search"] }];
  };

  const agent = createRecommendationAgent({ runModel: fakeRunner });
  await agent.recommend({ query: "dark ambient", artists: [] });

  assert.equal(capturedArgs.preferenceContext, "");
});

test("recommendation agent forwards messages to runModel", async () => {
  let capturedArgs;
  const fakeRunner = async (args) => {
    capturedArgs = args;
    return [{ artist: "X", why: "test", sourceSignals: ["musicbrainz_search"] }];
  };

  const agent = createRecommendationAgent({ runModel: fakeRunner });
  await agent.recommend({
    query: "more like that",
    artists: [],
    messages: [
      { role: "user", content: "I like Alcest" },
      { role: "assistant", content: "I recommended Fen, Deafheaven" },
    ],
  });

  assert.ok(Array.isArray(capturedArgs.messages), "messages forwarded");
  assert.equal(capturedArgs.messages.length, 2);
  assert.equal(capturedArgs.messages[0].role, "user");
});

test("createLangChainRunner rejects missing apiKey", async () => {
  await assert.rejects(() => createLangChainRunner({ timeoutMs: 100 }), /apiKey is required/);
});

test("recommendation agent rejects invalid model output shape", async () => {
  const agent = createRecommendationAgent({
    runModel: async () => [{ name: "missing fields" }],
  });

  await assert.rejects(
    () =>
      agent.recommend({
        query: "I like Alcest",
        artists: [],
      }),
    /invalid recommendation output/,
  );
});

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createRecommendationService,
  resolveRecommendationFacadeInput,
  enrichRecommendationsWithMbIds,
} = require("../src/recommendations");

test("recommendation service forwards musicbrainz artists to recommendation agent", async () => {
  const service = createRecommendationService({
    musicBrainzClient: {
      searchArtists: async () => [{ name: "Alcest", score: 100 }],
    },
    recommendationAgent: {
      recommend: async ({ artists }) => ({
        recommendations: [
          {
            artist: artists[0].name,
            why: "Agent generated recommendation.",
            sourceSignals: ["agent_reasoning"],
          },
        ],
        assistantReply: "Here are some niche picks based on your taste.",
      }),
    },
  });

  const result = await service.getRecommendations("I like atmospheric black metal");

  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].artist, "Alcest");
  assert.equal(result.recommendations[0].sourceSignals.includes("agent_reasoning"), true);
  assert.equal(result.assistantReply.includes("niche picks"), true);
});

test("enrichRecommendationsWithMbIds attaches MusicBrainz id when names match", () => {
  const items = [{ artist: "Fen", why: "x", sourceSignals: ["a"] }];
  const artists = [{ id: "mbid-fen", name: "Fen", score: 99, disambiguation: "" }];
  const out = enrichRecommendationsWithMbIds(items, artists);
  assert.equal(out[0].musicbrainzArtistId, "mbid-fen");
});

test("getRecommendations uses planMusicBrainzSearch for MusicBrainz when provided", async () => {
  const mbCalls = [];
  const service = createRecommendationService({
    musicBrainzClient: {
      searchArtists: async (q) => {
        mbCalls.push(q);
        return [{ name: "PlannedHit", score: 90 }];
      },
    },
    planMusicBrainzSearch: async ({ userQuery }) => `planned-from:${userQuery}`,
    recommendationAgent: {
      recommend: async ({ query, artists }) => {
        assert.equal(query, "I want something dreamy like Alcest but rawer");
        return {
          recommendations: [
            {
              artist: artists[0].name,
              why: "ok",
              sourceSignals: ["agent_reasoning"],
            },
          ],
          assistantReply: "",
        };
      },
    },
  });

  await service.getRecommendations("I want something dreamy like Alcest but rawer");

  assert.equal(mbCalls.length, 1);
  assert.equal(mbCalls[0], "planned-from:I want something dreamy like Alcest but rawer");
});

test("getRecommendations uses validateRecommendationMode for options.mode", async () => {
  const calls = [];
  const service = createRecommendationService({
    musicBrainzClient: {
      searchArtists: async () => [],
    },
    recommendationAgent: {
      recommend: async (args) => {
        calls.push(args);
        return { recommendations: [{ artist: "X", why: "y", sourceSignals: ["agent_reasoning"] }], assistantReply: "" };
      },
    },
  });

  await service.getRecommendations("q", { mode: "not-a-real-mode" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, "fresh");

  await service.getRecommendations("q", { mode: "preference-aware" });
  assert.equal(calls[1].mode, "preference-aware");
});

test("resolveRecommendationFacadeInput fresh mode does not call repository", async () => {
  let buildCalled = false;
  const preferenceRepository = {
    async buildContext() {
      buildCalled = true;
      return "repo";
    },
    async buildContextForIds() {
      return "";
    },
  };

  const result = await resolveRecommendationFacadeInput({ mode: "fresh", priorityContext: "  prio  " }, preferenceRepository);

  assert.equal(result.mode, "fresh");
  assert.equal(result.preferenceContext, "prio");
  assert.deepEqual(result.messages, []);
  assert.equal(buildCalled, false);
});

test("resolveRecommendationFacadeInput preference-aware merges priority and buildContext", async () => {
  const preferenceRepository = {
    async buildContext() {
      return "saved context";
    },
    async buildContextForIds() {
      return "";
    },
  };

  const result = await resolveRecommendationFacadeInput(
    { mode: "preference-aware", priorityContext: "note" },
    preferenceRepository,
  );

  assert.equal(result.mode, "preference-aware");
  assert.equal(result.preferenceContext, "note\nsaved context");
});

test("resolveRecommendationFacadeInput preference-aware uses buildContextForIds when ids provided", async () => {
  const preferenceRepository = {
    async buildContext() {
      return "full";
    },
    async buildContextForIds(ids) {
      return `ids:${ids.join(",")}`;
    },
  };

  const result = await resolveRecommendationFacadeInput(
    { mode: "preference-aware", selectedArtistIds: ["mb-1", "mb-2"] },
    preferenceRepository,
  );

  assert.ok(result.preferenceContext.includes("ids:mb-1,mb-2"));
});

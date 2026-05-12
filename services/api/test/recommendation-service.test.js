const test = require("node:test");
const assert = require("node:assert/strict");

const { createRecommendationService, resolveRecommendationFacadeInput } = require("../src/recommendations");

test("recommendation service forwards musicbrainz artists to recommendation agent", async () => {
  const service = createRecommendationService({
    musicBrainzClient: {
      searchArtists: async () => [{ name: "Alcest", score: 100 }],
    },
    recommendationAgent: {
      recommend: async ({ artists }) => [
        {
          artist: artists[0].name,
          why: "Agent generated recommendation.",
          sourceSignals: ["agent_reasoning"],
        },
      ],
    },
  });

  const recommendations = await service.getRecommendations("I like atmospheric black metal");

  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].artist, "Alcest");
  assert.equal(recommendations[0].sourceSignals.includes("agent_reasoning"), true);
});

test("resolveRecommendationFacadeInput fresh mode does not call repository", async () => {
  let buildCalled = false;
  const preferenceRepository = {
    async buildContext() {
      buildCalled = true;
      return "repo";
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

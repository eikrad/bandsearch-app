const test = require("node:test");
const assert = require("node:assert/strict");

const { createRecommendationService } = require("../src/recommendations");

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

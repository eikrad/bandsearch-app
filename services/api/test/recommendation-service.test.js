const test = require("node:test");
const assert = require("node:assert/strict");

const { createRecommendationService } = require("../src/recommendations");

test("recommendation service falls back deterministically when no artists found", async () => {
  const service = createRecommendationService({
    musicBrainzClient: {
      searchArtists: async () => [],
    },
  });

  const recommendations = await service.getRecommendations("I like atmospheric black metal");

  assert.equal(recommendations.length, 3);
  assert.equal(recommendations.every((item) => item.sourceSignals.includes("deterministic_fallback")), true);
  assert.equal(recommendations.every((item) => item.artist.includes("Related Artist")), true);
});

const test = require("node:test");
const assert = require("node:assert/strict");

const { createChatScreenModel } = require("../src/chatScreenModel");

test("screen model composes desktop card actions as visible", () => {
  const model = createChatScreenModel({
    viewModel: {
      getUiState: () => ({ mode: "fresh", isLoading: false, lastMeta: { modeUsed: "fresh" } }),
      getRenderableRecommendations: () => [
        {
          title: "Fen",
          reason: "Atmospheric overlap",
          signals: ["musicbrainz_search"],
          savedBand: { id: "pref-1", name: "Fen", rating: 5 },
          country: "UK",
          genres: ["post-black", "atmospheric"],
          connection: "Similar to Alcest.",
        },
      ],
    },
  });

  const screen = model.getScreenState({ viewport: "desktop" });
  assert.equal(screen.header.title, "Bandsearch");
  assert.equal(screen.mode, "fresh");
  assert.equal(screen.recommendationCards.length, 1);
  assert.equal(screen.recommendationCards[0].saved, true);
  assert.equal(screen.recommendationCards[0].rating, 5);
  assert.equal(screen.recommendationCards[0].actions.save.visible, true);
  assert.equal(screen.recommendationCards[0].actions.more.visible, true);
});

test("screen model collapses secondary actions on mobile", () => {
  const model = createChatScreenModel({
    viewModel: {
      getUiState: () => ({ mode: "preference-aware", isLoading: false, lastMeta: { modeUsed: "preference-aware" } }),
      getRenderableRecommendations: () => [
        { title: "Alcest", reason: "Dreamlike overlap", signals: ["deterministic_fallback"] },
      ],
    },
  });

  const screen = model.getScreenState({ viewport: "mobile" });
  assert.equal(screen.mode, "preference-aware");
  assert.equal(screen.recommendationCards[0].actions.save.visible, false);
  assert.equal(screen.recommendationCards[0].actions.more.visible, true);
});

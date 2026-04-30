const test = require("node:test");
const assert = require("node:assert/strict");

const { bootstrapDesktopUi } = require("../src");

test("desktop ui bootstrap returns render state and updates mode", () => {
  const ui = bootstrapDesktopUi({
    app: {
      requestRecommendations: async () => ({ recommendations: [], meta: { modeUsed: "fresh" } }),
      getState: () => ({ messages: [] }),
    },
  });

  const initial = ui.getRenderState();
  assert.equal(initial.mode, "fresh");
  assert.equal(initial.modeSelector.options.length, 2);

  const afterMode = ui.handleModeChange("preference-aware");
  assert.equal(afterMode.mode, "preference-aware");
});

test("desktop ui bootstrap refreshes render state after query submission", async () => {
  const appState = { messages: [] };
  const ui = bootstrapDesktopUi({
    app: {
      requestRecommendations: async () => {
        appState.messages = [
          {
            role: "assistant",
            recommendations: [
              {
                artist: "Fen",
                why: "Atmospheric overlap",
                sourceSignals: ["musicbrainz_search"],
              },
            ],
            meta: { modeUsed: "fresh", usedPreferenceContext: false },
          },
        ];
        return { recommendations: appState.messages[0].recommendations, meta: appState.messages[0].meta };
      },
      getState: () => appState,
    },
  });

  const state = await ui.handleQuerySubmit("I like blackgaze");
  assert.equal(state.recommendationList.items.length, 1);
  assert.equal(state.recommendationList.items[0].title, "Fen");
});

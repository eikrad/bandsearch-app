const test = require("node:test");
const assert = require("node:assert/strict");

const { bootstrapDesktopUi } = require("../src");

test("desktop ui bootstrap exposes mode get/set", () => {
  const ui = bootstrapDesktopUi({
    app: {
      requestRecommendations: async () => ({ recommendations: [], meta: { modeUsed: "fresh" } }),
      getState: () => ({ messages: [], savedBands: [] }),
    },
  });

  assert.equal(ui.getMode(), "fresh");
  ui.setMode("preference-aware");
  assert.equal(ui.getMode(), "preference-aware");
});

test("desktop ui bootstrap refreshes conversation after query submission", async () => {
  const appState = { messages: [], savedBands: [] };
  const ui = bootstrapDesktopUi({
    app: {
      requestRecommendations: async () => {
        appState.messages = [
          {
            role: "assistant",
            content: "",
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

  await ui.submitQuery("I like blackgaze");
  const conversation = ui.getConversation();
  assert.ok(conversation, "conversation is non-null after query");
  assert.equal(conversation[0].role, "assistant");
  assert.equal(conversation[0].cards[0].title, "Fen");
});

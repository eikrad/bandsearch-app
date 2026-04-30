const test = require("node:test");
const assert = require("node:assert/strict");

const { bootstrapDesktopReactShell } = require("../src");

test("desktop react shell renders HTML with recommendation card and actions", async () => {
  const appState = { messages: [] };
  const shell = bootstrapDesktopReactShell({
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

  await shell.submitQuery("I like post-black metal");
  const html = shell.renderHtml();
  assert.equal(html.includes("Fen"), true);
  assert.equal(html.includes("Save"), true);
  assert.equal(html.includes("Rate"), true);
  assert.equal(html.includes("More"), true);
});

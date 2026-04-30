const test = require("node:test");
const assert = require("node:assert/strict");

const { createChatViewModel } = require("../src/chatViewModel");

test("view model tracks mode and sends queries through app interface", async () => {
  const calls = [];
  const vm = createChatViewModel({
    app: {
      requestRecommendations: async (query, mode) => {
        calls.push({ query, mode });
        return {
          recommendations: [
            {
              artist: "Alcest",
              why: "Dreamlike blackgaze overlap",
              sourceSignals: ["musicbrainz_search"],
            },
          ],
          meta: { modeUsed: mode, usedPreferenceContext: mode === "preference-aware" },
        };
      },
      getState: () => ({ messages: [] }),
    },
  });

  vm.setMode("preference-aware");
  await vm.submitQuery("I like blackgaze");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, "preference-aware");
  assert.equal(vm.getUiState().lastMeta.modeUsed, "preference-aware");
});

test("view model formats recommendation list for rendering", () => {
  const vm = createChatViewModel({
    app: {
      requestRecommendations: async () => ({ recommendations: [], meta: { modeUsed: "fresh" } }),
      getState: () => ({
        messages: [
          {
            role: "assistant",
            recommendations: [
              { artist: "Fen", why: "Post-metal atmosphere", sourceSignals: ["deterministic_fallback"] },
            ],
            meta: { modeUsed: "fresh", usedPreferenceContext: false },
          },
        ],
      }),
    },
  });

  const rendered = vm.getRenderableRecommendations();
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].title, "Fen");
  assert.equal(rendered[0].reason.includes("Post-metal"), true);
});

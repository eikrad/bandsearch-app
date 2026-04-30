const test = require("node:test");
const assert = require("node:assert/strict");

const { createChatScreen } = require("../src/chatScreen");

test("chat screen exposes initial render state and mode options", () => {
  const screen = createChatScreen({
    viewModel: {
      setMode: () => {},
      getUiState: () => ({ mode: "fresh", isLoading: false, lastMeta: { modeUsed: "fresh" } }),
      getRenderableRecommendations: () => [],
      submitQuery: async () => ({ recommendations: [], meta: { modeUsed: "fresh" } }),
    },
    screenModel: {
      getScreenState: () => ({
        header: { title: "Bandsearch", subtitle: "Niche music recommendations" },
        mode: "fresh",
        isLoading: false,
        recommendationCards: [],
      }),
    },
  });

  const renderState = screen.getRenderState();
  assert.equal(renderState.header.title, "Bandsearch");
  assert.equal(renderState.modeSelector.options.length, 2);
  assert.equal(renderState.isLoading, false);
});

test("chat screen handlers update mode and submit query", async () => {
  const calls = [];
  const screen = createChatScreen({
    viewModel: {
      setMode: (mode) => calls.push({ type: "mode", mode }),
      getUiState: () => ({ mode: "fresh", isLoading: false, lastMeta: { modeUsed: "fresh" } }),
      getRenderableRecommendations: () => [],
      submitQuery: async (query) => {
        calls.push({ type: "submit", query });
        return { recommendations: [], meta: { modeUsed: "fresh" } };
      },
    },
    screenModel: {
      getScreenState: () => ({
        header: { title: "Bandsearch", subtitle: "Niche music recommendations" },
        mode: "fresh",
        isLoading: false,
        recommendationCards: [],
      }),
    },
  });

  screen.handleModeChange("preference-aware");
  await screen.handleQuerySubmit("I like atmospheric black metal");

  assert.equal(calls.length, 2);
  assert.equal(calls[0].mode, "preference-aware");
  assert.equal(calls[1].query, "I like atmospheric black metal");
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeDesktopApp } = require("./helpers/fakeApp");

const { bootstrapDesktopUi } = require("../src");
const { createDesktopChatUiStack } = require("../src/desktopChatUiStack");

test("desktop ui bootstrap exposes mode get/set", () => {
  const ui = bootstrapDesktopUi({
    app: fakeDesktopApp({
      requestRecommendations: async () => ({ recommendations: [], meta: { modeUsed: "fresh" } }),
      getState: () => ({ messages: [], savedBands: [] }),
    }),
  });

  assert.equal(ui.getMode(), "fresh");
  ui.setMode("preference-aware");
  assert.equal(ui.getMode(), "preference-aware");
});

test("desktop ui bootstrap refreshes conversation after query submission", async () => {
  const appState = { messages: [], savedBands: [] };
  const ui = bootstrapDesktopUi({
    app: fakeDesktopApp({
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
    }),
  });

  await ui.submitQuery("I like blackgaze");
  const conversation = ui.getConversation();
  assert.ok(conversation, "conversation is non-null after query");
  assert.equal(conversation[0].role, "assistant");
  assert.equal(conversation[0].cards[0].title, "Fen");
});

test("desktopChatUiStack exposes cancelSearch that delegates to app.cancelSearch", () => {
  let cancelled = false;
  const stack = createDesktopChatUiStack({
    app: fakeDesktopApp({
      requestRecommendations: async () => ({ recommendations: [], meta: {} }),
      cancelSearch: () => { cancelled = true; },
      getState: () => ({ messages: [], savedBands: [] }),
    }),
  });

  stack.cancelSearch();
  assert.equal(cancelled, true);
});

test("desktopChatUiStack exposes retryLastSearch that delegates to appModel", async () => {
  const calls = [];
  const stack = createDesktopChatUiStack({
    app: fakeDesktopApp({
      requestRecommendations: async (query) => {
        calls.push(query);
        return { recommendations: [], meta: {} };
      },
      cancelSearch: () => {},
      getState: () => ({ messages: [], savedBands: [] }),
    }),
  });

  await stack.submitQuery("jazz fusion");
  calls.length = 0; // clear first call
  await stack.retryLastSearch();
  assert.equal(calls.length, 1, "retryLastSearch triggered a request");
  assert.equal(calls[0], "jazz fusion");
});

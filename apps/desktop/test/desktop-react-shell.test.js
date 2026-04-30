const test = require("node:test");
const assert = require("node:assert/strict");

const { bootstrapDesktopReactShell } = require("../src");
const { createDesktopReactShell } = require("../src/ui/createDesktopReactShell");

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

test("desktop react shell save and rate actions call app handlers", async () => {
  const calls = [];
  const shell = bootstrapDesktopReactShell({
    app: {
      requestRecommendations: async () => ({ recommendations: [], meta: { modeUsed: "fresh" } }),
      getState: () => ({ messages: [] }),
      saveBand: async (artistName) => {
        calls.push({ type: "save", artistName });
      },
      rateBand: async (artistName, rating) => {
        calls.push({ type: "rate", artistName, rating });
      },
    },
  });

  await shell.saveBand("Fen");
  const afterSave = shell.getViewProps();
  await shell.rateBand("Fen", 5);
  const afterRate = shell.getViewProps();

  assert.equal(calls.length, 2);
  assert.equal(calls[0].type, "save");
  assert.equal(calls[1].type, "rate");
  assert.equal(calls[1].rating, 5);
  assert.equal(afterSave.actionStatus.message, "Saved Fen.");
  assert.equal(afterRate.actionStatus.message, "Rated Fen: 5/5.");
});

test("desktop react shell clears action status after timeout", async () => {
  let scheduled;
  const shell = createDesktopReactShell({
    renderAdapter: {
      getViewProps: () => ({
        headerTitle: "Bandsearch",
        headerSubtitle: "Niche recommendations",
        viewport: "desktop",
        modeValue: "fresh",
        modeOptions: [],
        queryPlaceholder: "Describe bands...",
        queryDisabled: false,
        cards: [],
        emptyText: "No recommendations yet.",
      }),
      onModeChange: () => ({}),
      onSubmitQuery: async () => ({}),
    },
    actionHandlers: {
      onSave: async () => ({}),
    },
    statusTimeoutMs: 10,
    setTimeoutImpl: (fn) => {
      scheduled = fn;
      return 1;
    },
  });

  await shell.saveBand("Fen");
  assert.equal(shell.getViewProps().actionStatus.message, "Saved Fen.");
  scheduled();
  assert.equal(shell.getViewProps().actionStatus, null);
});

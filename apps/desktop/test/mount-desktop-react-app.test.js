const test = require("node:test");
const assert = require("node:assert/strict");

const { createDesktopReactMount } = require("../src/ui/mountDesktopReactApp");

test("desktop react mount renders and wires interaction callbacks", async () => {
  const calls = [];
  const fakeRoot = {
    render: (element) => {
      calls.push({ type: "render", element });
    },
  };
  const fakeCreateRoot = () => fakeRoot;
  const fakeContainer = {};

  const shell = {
    getViewProps: () => ({
      headerTitle: "Bandsearch",
      headerSubtitle: "Niche recommendations",
      modeValue: "fresh",
      modeOptions: [{ value: "fresh", label: "Fresh search" }],
      queryPlaceholder: "Describe bands...",
      queryDisabled: false,
      cards: [],
      emptyText: "No recommendations yet.",
    }),
    updateMode: async (mode) => calls.push({ type: "mode", mode }),
    submitQuery: async (query) => calls.push({ type: "query", query }),
    saveBand: async (artistName) => calls.push({ type: "save", artistName }),
    rateBand: async (artistName, rating) => calls.push({ type: "rate", artistName, rating }),
  };

  const mount = createDesktopReactMount({
    shell,
    createRootImpl: fakeCreateRoot,
    resolveContainer: () => fakeContainer,
  });

  mount.mount();
  assert.equal(calls[0].type, "render");

  await mount.handlers.onModeChange("preference-aware");
  await mount.handlers.onQuerySubmit("I like blackgaze");
  await mount.handlers.onSave("Fen");
  await mount.handlers.onRate("Fen");

  assert.equal(calls.some((item) => item.type === "mode"), true);
  assert.equal(calls.some((item) => item.type === "query"), true);
  assert.equal(calls.some((item) => item.type === "save"), true);
  assert.equal(calls.some((item) => item.type === "rate"), true);
});

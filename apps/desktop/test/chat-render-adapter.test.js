const test = require("node:test");
const assert = require("node:assert/strict");

const { createChatRenderAdapter } = require("../src/chatRenderAdapter");

test("render adapter builds view props from UI render state", () => {
  const adapter = createChatRenderAdapter({
    desktopUi: {
      getRenderState: () => ({
        header: { title: "Bandsearch", subtitle: "Niche music recommendations" },
        mode: "fresh",
        isLoading: false,
        modeSelector: { value: "fresh", options: [{ value: "fresh", label: "Fresh search" }] },
        queryInput: { placeholder: "Describe bands you like...", disabled: false },
        recommendationList: { items: [{ title: "Fen", why: "Atmospheric overlap" }], emptyText: "none" },
      }),
    },
  });

  const props = adapter.getViewProps();
  assert.equal(props.headerTitle, "Bandsearch");
  assert.equal(props.viewport, "desktop");
  assert.equal(props.modeValue, "fresh");
  assert.equal(props.cards.length, 1);
});

test("render adapter forwards interaction handlers and refreshes state", async () => {
  const calls = [];
  const adapter = createChatRenderAdapter({
    desktopUi: {
      getRenderState: () => ({
        header: { title: "Bandsearch", subtitle: "" },
        mode: "fresh",
        isLoading: false,
        modeSelector: { value: "fresh", options: [] },
        queryInput: { placeholder: "", disabled: false },
        recommendationList: { items: [], emptyText: "" },
      }),
      handleModeChange: (mode) => {
        calls.push({ type: "mode", mode });
        return {
          header: { title: "Bandsearch", subtitle: "" },
          mode,
          isLoading: false,
          modeSelector: { value: mode, options: [] },
          queryInput: { placeholder: "", disabled: false },
          recommendationList: { items: [], emptyText: "" },
        };
      },
      handleQuerySubmit: async (query) => {
        calls.push({ type: "submit", query });
        return {
          header: { title: "Bandsearch", subtitle: "" },
          mode: "fresh",
          isLoading: false,
          modeSelector: { value: "fresh", options: [] },
          queryInput: { placeholder: "", disabled: false },
          recommendationList: { items: [{ title: "Alcest", why: "Dreamlike blackgaze" }], emptyText: "" },
        };
      },
    },
  });

  const afterMode = adapter.onModeChange("preference-aware");
  const afterSubmit = await adapter.onSubmitQuery("I like blackgaze");

  assert.equal(calls.length, 2);
  assert.equal(afterMode.modeValue, "preference-aware");
  assert.equal(afterSubmit.cards[0].title, "Alcest");
});

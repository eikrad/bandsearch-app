const test = require("node:test");
const assert = require("node:assert/strict");

const { createChatRenderAdapter } = require("../src/chatRenderAdapter");

function makeCard(title, overrides = {}) {
  return {
    title,
    why: "Some reason",
    country: "GB",
    genres: ["post-metal"],
    signals: ["musicbrainz_search"],
    connection: "",
    imageUrl: null,
    saved: false,
    rating: null,
    savedBandId: null,
    ...overrides,
  };
}

function makeDesktopUi(overrides = {}) {
  let mode = "fresh";
  let obscurityTarget = "underground";
  let conversation = null;
  return {
    getViewport: () => "desktop",
    getMode: () => mode,
    isLoading: () => false,
    getConversation: () => conversation,
    setMode: (m) => { mode = m; },
    setObscurityTarget: (t) => { obscurityTarget = t; },
    getObscurityTarget: () => obscurityTarget,
    submitQuery: async () => {},
    _setConversation: (c) => { conversation = c; },
    _setMode: (m) => { mode = m; },
    ...overrides,
  };
}

test("render adapter builds header and platform links from conversation cards", () => {
  const ui = makeDesktopUi();
  ui._setConversation([
    { id: "a-0", role: "assistant", content: "", cards: [makeCard("Fen")] },
  ]);

  const adapter = createChatRenderAdapter({ desktopUi: ui });
  const props = adapter.getViewProps();

  assert.equal(props.headerTitle, "Bandsearch");
  assert.equal(props.viewport, "desktop");
  assert.equal(props.modeValue, "fresh");
  assert.equal(props.cards.length, 1);
  assert.equal(Array.isArray(props.cards[0].platformLinks), true, "platformLinks array on card");
  assert.equal(props.cards[0].platformLinks.length, 3, "bandcamp + soundcloud + spotify");
  assert.equal(props.cards[0].platformLinks[0].platform, "bandcamp");
});

test("render adapter preserves imageUrl from card", () => {
  const ui = makeDesktopUi();
  ui._setConversation([
    {
      id: "a-0",
      role: "assistant",
      content: "",
      cards: [makeCard("Alcest", { imageUrl: "https://example.com/alcest.jpg" })],
    },
  ]);

  const adapter = createChatRenderAdapter({ desktopUi: ui });
  const props = adapter.getViewProps();

  assert.equal(props.cards[0].imageUrl, "https://example.com/alcest.jpg");
});

test("render adapter hides save/rate actions on mobile", () => {
  const ui = makeDesktopUi({ getViewport: () => "mobile" });
  ui._setConversation([
    { id: "a-0", role: "assistant", content: "", cards: [makeCard("Fen")] },
  ]);

  const adapter = createChatRenderAdapter({ desktopUi: ui });
  const props = adapter.getViewProps();

  assert.equal(props.cards[0].actions.save.visible, false, "save hidden on mobile");
  assert.equal(props.cards[0].actions.rate.visible, false, "rate hidden on mobile");
  assert.equal(props.cards[0].actions.more.visible, true, "more always visible");
});

test("render adapter shows save/rate actions on desktop", () => {
  const ui = makeDesktopUi();
  ui._setConversation([
    { id: "a-0", role: "assistant", content: "", cards: [makeCard("Fen")] },
  ]);

  const adapter = createChatRenderAdapter({ desktopUi: ui });
  const props = adapter.getViewProps();

  assert.equal(props.cards[0].actions.save.visible, true, "save visible on desktop");
  assert.equal(props.cards[0].actions.rate.visible, true, "rate visible on desktop");
});

test("onModeChange updates mode and returns refreshed view props", () => {
  const ui = makeDesktopUi();
  const adapter = createChatRenderAdapter({ desktopUi: ui });

  const afterMode = adapter.onModeChange("preference-aware");

  assert.equal(afterMode.modeValue, "preference-aware");
});

test("onSubmitQuery delegates to desktopUi and returns updated cards", async () => {
  const ui = makeDesktopUi();
  ui.submitQuery = async () => {
    ui._setConversation([
      { id: "a-0", role: "assistant", content: "", cards: [makeCard("Alcest")] },
    ]);
  };

  const adapter = createChatRenderAdapter({ desktopUi: ui });
  const afterSubmit = await adapter.onSubmitQuery("I like blackgaze");

  assert.equal(afterSubmit.cards[0].title, "Alcest");
});

// ─── Phase 8.3b: obscurityTarget in viewProps ────────────────────────────────

test("render adapter includes obscurityTarget in viewProps (default: underground)", () => {
  const ui = makeDesktopUi();
  const adapter = createChatRenderAdapter({ desktopUi: ui });
  const props = adapter.getViewProps();
  assert.equal(props.obscurityTarget, "underground");
});

test("render adapter onObscurityTargetChange updates viewProps", () => {
  const ui = makeDesktopUi();
  const adapter = createChatRenderAdapter({ desktopUi: ui });
  adapter.onObscurityTargetChange("obscure");
  const props = adapter.getViewProps();
  assert.equal(props.obscurityTarget, "obscure");
});

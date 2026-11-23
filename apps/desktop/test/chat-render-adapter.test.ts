import test from "node:test";
import assert from "node:assert/strict";
import { createChatRenderAdapter } from "../src/chatRenderAdapter.js";
import type {
  ConversationMessage,
  RenderableRecommendation,
} from "../src/chatAppModel.js";
import type { ChatScreenModel } from "../src/chatRenderAdapter.js";

function makeCard(
  title: string,
  overrides: Partial<RenderableRecommendation> = {},
): RenderableRecommendation {
  return {
    title,
    target: { name: title },
    why: "Some reason",
    country: "GB",
    genres: ["post-metal"],
    signals: ["musicbrainz_search"],
    connection: "",
    imageUrl: null,
    saved: false,
    rating: null,
    savedBandId: null,
    categories: [],
    note: "",
    noteEdited: false,
    ...overrides,
  };
}

type TestChat = ChatScreenModel & {
  _setConversation(conversation: ConversationMessage[] | null): void;
  _setMode(mode: string): void;
};

function makeChat(overrides: Partial<TestChat> = {}): TestChat {
  let mode = "fresh";
  let obscurityTarget: string | undefined = "underground";
  let conversation: ConversationMessage[] | null = null;
  return {
    cancelSearch: () => {},
    retryLastSearch: async () => undefined,
    getMode: () => mode,
    isLoading: () => false,
    getProgress: () => null,
    subscribe: () => () => {},
    isShowFeedbackBar: () => false,
    dismissFeedbackBar: () => {},
    submitFeedback: async () => {},
    getConversation: () => conversation,
    setMode: (m: string) => { mode = m; },
    setObscurityTarget: (t: string | undefined) => { obscurityTarget = t; },
    getObscurityTarget: () => obscurityTarget,
    submitQuery: async () => undefined,
    _setConversation: (c: ConversationMessage[] | null) => { conversation = c; },
    _setMode: (m: string) => { mode = m; },
    ...overrides,
  };
}

test("render adapter builds header and platform links from conversation cards", () => {
  const ui = makeChat();
  ui._setConversation([
    { id: "a-0", role: "assistant", content: "", cards: [makeCard("Fen")] },
  ]);

  const adapter = createChatRenderAdapter({ chat: ui });
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
  const ui = makeChat();
  ui._setConversation([
    {
      id: "a-0",
      role: "assistant",
      content: "",
      cards: [makeCard("Alcest", { imageUrl: "https://example.com/alcest.jpg" })],
    },
  ]);

  const adapter = createChatRenderAdapter({ chat: ui });
  const props = adapter.getViewProps();

  assert.equal(props.cards[0].imageUrl, "https://example.com/alcest.jpg");
});

// UI_GUIDELINES.md, "Action row policy (locked, all viewports)": the rating
// stars and Save are primary and never collapse, on any screen size — saving
// is what makes preference-aware mode work at all, so it stays one tap away
// everywhere. This used to be `!isMobile`-gated (#152), which contradicted a
// spec written 15 minutes before the code that broke it.
for (const viewport of ["mobile", "desktop"] as const) {
  test(`render adapter keeps save/rate/more actions visible on ${viewport}`, () => {
    const ui = makeChat();
    ui._setConversation([
      { id: "a-0", role: "assistant", content: "", cards: [makeCard("Fen")] },
    ]);

    const adapter = createChatRenderAdapter({ chat: ui, viewport });
    const props = adapter.getViewProps();
    assert.equal(props.viewport, viewport);

    assert.equal(props.cards[0].actions.save.visible, true, `save visible on ${viewport}`);
    assert.equal(props.cards[0].actions.rate.visible, true, `rate visible on ${viewport}`);
    assert.equal(props.cards[0].actions.more.visible, true, `more visible on ${viewport}`);
  });
}

test("onModeChange updates mode and returns refreshed view props", () => {
  const ui = makeChat();
  const adapter = createChatRenderAdapter({ chat: ui });

  const afterMode = adapter.onModeChange("preference-aware");

  assert.equal(afterMode.modeValue, "preference-aware");
});

test("onSubmitQuery runs the search and returns updated cards", async () => {
  const ui = makeChat();
  ui.submitQuery = async () => {
    ui._setConversation([
      { id: "a-0", role: "assistant", content: "", cards: [makeCard("Alcest")] },
    ]);
  };

  const adapter = createChatRenderAdapter({ chat: ui });
  const afterSubmit = await adapter.onSubmitQuery("I like blackgaze");

  assert.equal(afterSubmit.cards[0].title, "Alcest");
});

// ─── Phase 8.3b: obscurityTarget in viewProps ────────────────────────────────

test("render adapter includes obscurityTarget in viewProps (default: underground)", () => {
  const ui = makeChat();
  const adapter = createChatRenderAdapter({ chat: ui });
  const props = adapter.getViewProps();
  assert.equal(props.obscurityTarget, "underground");
});

test("render adapter onObscurityTargetChange updates viewProps", () => {
  const ui = makeChat();
  const adapter = createChatRenderAdapter({ chat: ui });
  adapter.onObscurityTargetChange("obscure");
  const props = adapter.getViewProps();
  assert.equal(props.obscurityTarget, "obscure");
});

test("the in-flight line says what the API is doing, and whether it was heard from at all", () => {
  const adapter = createChatRenderAdapter({
    chat: makeChat({ isLoading: () => true, getProgress: () => ({ stage: "checking", found: 25 }) }),
  });
  assert.equal(adapter.getViewProps().progressLabel, "Found 25 bands, checking them…");
  assert.equal(adapter.getViewProps().awaitingApi, false);

  const waiting = createChatRenderAdapter({ chat: makeChat({ isLoading: () => true }) }).getViewProps();
  assert.equal(waiting.awaitingApi, true);
  assert.equal(createChatRenderAdapter({ chat: makeChat() }).getViewProps().awaitingApi, false, "nothing is in flight");
});

import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatAppView } from "../src/ui/ChatAppView.js";
import { cardViewProps, chatHandlers, chatViewProps } from "./helpers/fakeViewProps.js";

const FRESH_ONLY = [{ value: "fresh", label: "Fresh search" }];

test("ChatAppView renders mode, query input, cards, and action buttons", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({
        modeOptions: [
          { value: "fresh", label: "Fresh search" },
          { value: "preference-aware", label: "Preference-aware" },
        ],
        queryPlaceholder: "Describe bands...",
        cards: [
          cardViewProps({
            title: "Fen",
            why: "Atmospheric overlap",
            saved: true,
            rating: 4,
            country: "UK",
            genres: ["post-black"],
            connection: "Related to Alcest",
          }),
        ],
        actionStatus: { type: "success", message: "Saved Fen." },
      }),
      handlers: chatHandlers(),
    }),
  );

  assert.equal(html.includes("Bandsearch"), true);
  assert.equal(html.includes("Fresh search"), true);
  assert.equal(html.includes("Describe bands..."), true);
  assert.equal(html.includes("Fen"), true);
  assert.equal(html.includes("Save"), true);
  assert.equal(html.includes("Rate"), true);
  assert.equal(html.includes("···"), true, "more button shows ··· ellipsis");
  assert.equal(html.includes("More"), false, "more button does not say More");
  assert.equal(html.includes("saved · 4/5"), true);
  assert.equal(html.includes("Saved Fen."), true);
});

test("RecommendationCard renders 5 rating stars, filled up to the current rating", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({
        cards: [cardViewProps({ title: "Fen", rating: 3 })],
      }),
      handlers: chatHandlers(),
    }),
  );

  const filled = (html.match(/★/g) || []).length;
  const empty = (html.match(/☆/g) || []).length;
  assert.equal(filled, 3, "3 filled stars for a rating of 3");
  assert.equal(empty, 2, "2 empty stars for the remainder");
});

test("RecommendationCard renders no filled stars when unrated", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({
        cards: [cardViewProps({ title: "Fen", rating: null })],
      }),
      handlers: chatHandlers(),
    }),
  );

  assert.equal((html.match(/★/g) || []).length, 0);
  assert.equal((html.match(/☆/g) || []).length, 5);
});

test("RecommendationCard's Save action reads Save when unsaved and Saved when saved", () => {
  const unsavedHtml = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({ cards: [cardViewProps({ title: "Fen", saved: false })] }),
      handlers: chatHandlers(),
    }),
  );
  const savedHtml = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({ cards: [cardViewProps({ title: "Fen", saved: true, savedBandId: "band-1" })] }),
      handlers: chatHandlers(),
    }),
  );

  // The header always has its own "Saved" nav button (see chatHandlers()'s
  // onNavigateSaved), so ">Saved<" alone isn't specific to the card toggle —
  // counting occurrences is: unsaved has only the header's, saved adds the
  // card's on top of it.
  const countOf = (html: string, needle: string) => html.split(needle).length - 1;
  assert.equal(countOf(unsavedHtml, ">Save<"), 1, "card shows Save when unsaved");
  assert.equal(countOf(unsavedHtml, ">Saved<"), 1, "only the header's Saved nav button");
  assert.equal(countOf(savedHtml, ">Saved<"), 2, "header nav button plus the card's toggle");
  assert.equal(countOf(savedHtml, ">Save<"), 0, "no standalone Save button when the card is saved");
});

test("RecommendationCard has CSS class for card styling", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({
        modeOptions: FRESH_ONLY,
        cards: [
          cardViewProps({
            title: "Fen",
            why: "Atmospheric post-metal",
            country: "UK",
            genres: ["post-black"],
          }),
        ],
        actionStatus: null,
      }),
      handlers: chatHandlers({ onNavigateSettings: () => {}, onNavigateSaved: () => {} }),
    }),
  );

  assert.equal(
    html.includes('class="recommendation-card"'),
    true,
    "card article should have CSS class recommendation-card",
  );
  assert.equal(
    html.includes("padding:16px"),
    false,
    "compact card must not use old 16px padding",
  );
});

test("ChatAppView shows loading indicator while recommendations are in flight", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({
        modeOptions: FRESH_ONLY,
        queryDisabled: true,
        isLoading: true,
      }),
      handlers: chatHandlers({ onNavigateSettings: () => {}, onNavigateSaved: () => {} }),
    }),
  );

  assert.equal(html.includes("Searching"), true, "submit button shows in-flight label");
  assert.equal(html.includes("Finding niche recommendations"), true, "status text visible");
  assert.equal(html.includes("bandsearch-spinner"), true, "spinner CSS hook present");
  assert.equal(html.includes("search-in-progress"), true, "loading region present");
});

test("ChatAppView renders conversation thread when messages prop provided", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({
        modeOptions: [{ value: "fresh", label: "Fresh" }],
        messages: [
          { id: "m1", role: "user", content: "I like atmospheric bands" },
          {
            id: "m2",
            role: "assistant",
            content: "Here are picks in that vein — want something heavier or more shoegaze?",
            cards: [
              cardViewProps({
                title: "Fen",
                why: "Atmospheric overlap",
                actions: { save: { visible: true }, rate: { visible: false }, more: { visible: false } },
              }),
            ],
          },
        ],
      }),
      handlers: chatHandlers({ onNavigateSettings: () => {}, onNavigateSaved: () => {} }),
    }),
  );

  assert.equal(html.includes("bandsearch-desktop-split"), true, "desktop uses chat + results rail (B)");
  assert.equal(html.includes("Latest picks"), true, "latest cards live in right rail");
  assert.equal(html.includes("I like atmospheric bands"), true, "user message rendered");
  assert.equal(html.includes("heavier or more shoegaze"), true, "assistant prose rendered in chat column");
  assert.equal(html.includes("Fen"), true, "assistant picks appear in rail");
});

test("ChatAppView mobile keeps cards in the scroll thread (layout A)", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({
        viewport: "mobile",
        modeOptions: FRESH_ONLY,
        messages: [
          { id: "m1", role: "user", content: "I like atmospheric bands" },
          {
            id: "m2",
            role: "assistant",
            content: "Here are picks.",
            cards: [
              cardViewProps({
                title: "Fen",
                why: "Atmospheric overlap",
                actions: { save: { visible: true }, rate: { visible: false }, more: { visible: false } },
              }),
            ],
          },
        ],
      }),
      handlers: chatHandlers({ onNavigateSettings: () => {}, onNavigateSaved: () => {} }),
    }),
  );

  assert.equal(html.includes("bandsearch-desktop-split"), false, "no split rail on mobile");
  assert.ok(html.includes("Fen"), "card stays inline in thread");
});

test("ChatAppView desktop collapses earlier recommendation turns (C)", () => {
  const hiddenActions = { save: { visible: true }, rate: { visible: false }, more: { visible: false } };
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({
        modeOptions: FRESH_ONLY,
        messages: [
          { id: "u1", role: "user", content: "Round one" },
          {
            id: "a1",
            role: "assistant",
            content: "First suggestions.",
            cards: [cardViewProps({ title: "EarlierArtist", why: "Because", actions: hiddenActions })],
          },
          { id: "u2", role: "user", content: "Round two" },
          {
            id: "a2",
            role: "assistant",
            content: "Latest suggestions.",
            cards: [cardViewProps({ title: "LatestArtist", why: "Fit", actions: hiddenActions })],
          },
        ],
      }),
      handlers: chatHandlers({ onNavigateSettings: () => {}, onNavigateSaved: () => {} }),
    }),
  );

  assert.ok(html.includes("bandsearch-earlier-picks"), "earlier picks use collapsible details");
  assert.ok(html.includes("Earlier picks (1)"), "summary labels earlier card stack");
  assert.ok(html.includes("LatestArtist"), "latest turn cards appear in rail");
  assert.ok(html.includes("EarlierArtist"), "older cards stay in collapsed section");
});

test("ChatAppView renders artist image when imageUrl is provided on card", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({
        modeOptions: [{ value: "fresh", label: "Fresh" }],
        cards: [
          cardViewProps({
            title: "Fen",
            genres: ["post-black"],
            imageUrl: "https://commons.wikimedia.org/fen.jpg",
            actions: { save: { visible: false }, rate: { visible: false }, more: { visible: false } },
          }),
        ],
      }),
      handlers: chatHandlers({ onNavigateSettings: () => {}, onNavigateSaved: () => {} }),
    }),
  );

  assert.equal(html.includes("https://commons.wikimedia.org/fen.jpg"), true, "image src rendered");
});

test("ChatAppView renders platform links when provided on card", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({
        modeOptions: [{ value: "fresh", label: "Fresh" }],
        cards: [
          cardViewProps({
            title: "Fen",
            platformLinks: [
              { platform: "bandcamp", url: "https://bandcamp.com/search?q=Fen", label: "Bandcamp" },
              { platform: "spotify", url: "https://open.spotify.com/search/Fen", label: "Spotify" },
            ],
            actions: { save: { visible: false }, rate: { visible: false }, more: { visible: false } },
          }),
        ],
      }),
      handlers: chatHandlers({ onNavigateSettings: () => {}, onNavigateSaved: () => {} }),
    }),
  );

  assert.equal(html.includes("bandcamp.com"), true, "bandcamp link rendered");
  assert.equal(html.includes("spotify.com"), true, "spotify link rendered");
});

test("ChatAppView renders a Saved Artists navigation button", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({ modeOptions: [{ value: "fresh", label: "Fresh" }] }),
      handlers: chatHandlers({ onNavigateSettings: () => {}, onNavigateSaved: () => {} }),
    }),
  );

  assert.equal(html.includes("Saved") || html.includes("saved"), true, "has saved artists nav link");
});

test("ChatAppView renders a Settings navigation button", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({ modeOptions: [{ value: "fresh", label: "Fresh" }] }),
      handlers: chatHandlers({ onNavigateSettings: () => {}, onNavigateSaved: () => {} }),
    }),
  );

  assert.equal(html.includes("Settings"), true);
});

test("ChatAppView renders genre chips for cards with genres", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({
        modeOptions: [{ value: "fresh", label: "Fresh" }],
        cards: [
          cardViewProps({
            title: "Wolves in the Throne Room",
            genres: ["atmospheric-black", "cascadian"],
            actions: { save: { visible: true }, rate: { visible: false }, more: { visible: false } },
          }),
        ],
      }),
      handlers: chatHandlers(),
    }),
  );

  assert.equal(html.includes("atmospheric-black"), true, "first genre chip rendered");
  assert.equal(html.includes("cascadian"), true, "second genre chip rendered");
});

test("RecommendationCard renders a per-card copy button", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({
        modeOptions: [{ value: "fresh", label: "Fresh" }],
        cards: [
          cardViewProps({
            title: "Fen",
            why: "Atmospheric overlap",
            actions: { save: { visible: true }, rate: { visible: false }, more: { visible: false } },
          }),
        ],
      }),
      handlers: chatHandlers({ onCopyCard: () => {} }),
    }),
  );

  assert.equal(html.includes("copy-card-btn"), true, "should render per-card copy button");
});

test("MessageThread renders copy-all button for assistant message with cards", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({
        viewport: "mobile",
        modeOptions: [{ value: "fresh", label: "Fresh" }],
        messages: [
          { id: "u1", role: "user", content: "I like dark ambient" },
          {
            id: "a1",
            role: "assistant",
            content: "Here are picks.",
            cards: [
              cardViewProps({
                title: "Fen",
                why: "Atmospheric",
                actions: { save: { visible: true }, rate: { visible: false }, more: { visible: false } },
              }),
            ],
          },
        ],
      }),
      handlers: chatHandlers({ onCopyCard: () => {}, onCopyAll: () => {} }),
    }),
  );

  assert.equal(html.includes("copy-all-btn"), true, "should render copy-all button on assistant reply with cards");
});

test("ChatAppView uses compact mobile layout and action density", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({
        viewport: "mobile",
        modeValue: "preference-aware",
        modeOptions: [{ value: "preference-aware", label: "Preference-aware" }],
        cards: [
          cardViewProps({
            title: "Alcest",
            why: "Dreamlike overlap",
            actions: {
              save: { visible: false },
              rate: { visible: false },
              more: { visible: true },
            },
          }),
        ],
      }),
      handlers: chatHandlers(),
    }),
  );

  assert.equal(html.includes("flex-direction:column"), true);
  assert.equal(html.includes("···"), true, "more button shows ···");
  // Save/Rate action buttons should not appear when not visible on the card
  // (Note: the header has a "Saved" nav button, so we check for the action button text only)
  assert.equal(html.includes(">Save<"), false, "card Save action not rendered");
  assert.equal(html.includes("Rate"), false);
});

test("ChatAppView renders stop button inside SearchInProgress when isLoading", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({
        headerSubtitle: "",
        modeOptions: FRESH_ONLY,
        queryDisabled: true,
        isLoading: true,
        actionStatus: null,
      }),
      handlers: chatHandlers({ onStop: () => {} }),
    }),
  );

  assert.equal(html.includes("stop"), true, "stop button renders while loading");
});

test("ChatAppView does not render stop button when not loading", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({
        headerSubtitle: "",
        modeOptions: FRESH_ONLY,
        actionStatus: null,
      }),
      handlers: chatHandlers({ onStop: () => {} }),
    }),
  );

  assert.equal(html.includes(">stop<"), false, "stop button not rendered when idle");
});

test("ChatAppView renders retry button on last user message when not loading", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({
        headerSubtitle: "",
        modeOptions: FRESH_ONLY,
        actionStatus: null,
        messages: [
          { id: "u-0", role: "user", content: "post-metal" },
          { id: "a-1", role: "assistant", content: "Here are picks", cards: [] },
        ],
      }),
      handlers: chatHandlers({ onStop: () => {}, onRetry: () => {} }),
    }),
  );

  assert.equal(html.includes("retry"), true, "retry button rendered on last user message");
});

test("ChatAppView does not render retry button when loading", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({
        headerSubtitle: "",
        modeOptions: FRESH_ONLY,
        queryDisabled: true,
        isLoading: true,
        actionStatus: null,
        messages: [{ id: "u-0", role: "user", content: "post-metal" }],
      }),
      handlers: chatHandlers({ onStop: () => {}, onRetry: () => {} }),
    }),
  );

  assert.equal(html.includes(">retry<"), false, "retry button not shown while loading");
});

test("a user is told they are talking to an AI before they type anything", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({
        headerSubtitle: "",
        modeOptions: FRESH_ONLY,
        cards: [],
        messages: [],
        actionStatus: null,
      }),
      handlers: chatHandlers(),
    }),
  );

  assert.match(
    html,
    /AI-generated recommendations/i,
    "empty state discloses that recommendations come from an AI",
  );
  assert.match(html, /Gemini/, "the disclosure names the model provider");
});

test("the AI disclosure stays visible while results are on screen", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({
        headerSubtitle: "",
        modeOptions: FRESH_ONLY,
        cards: [cardViewProps({ title: "Fen", why: "Atmospheric overlap" })],
        actionStatus: null,
      }),
      handlers: chatHandlers(),
    }),
  );

  assert.match(html, /AI-generated recommendations/i, "disclosure persists once results are shown");
});

test("each recommendation is visibly marked as AI-generated", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({
        headerSubtitle: "",
        modeOptions: FRESH_ONLY,
        cards: [cardViewProps({ title: "Fen", why: "Atmospheric overlap" })],
        actionStatus: null,
      }),
      handlers: chatHandlers(),
    }),
  );

  const card = html.slice(html.indexOf('<article class="recommendation-card"'));
  const cardMarkup = card.slice(0, card.indexOf("</article>"));
  assert.match(
    cardMarkup,
    /AI-generated/,
    "the card itself carries a visible AI-generated marking, not just the composer",
  );
});

test("recommendation prose is machine-readably marked as AI-generated", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: chatViewProps({
        headerSubtitle: "",
        modeOptions: FRESH_ONLY,
        cards: [cardViewProps({ title: "Fen", why: "Atmospheric overlap" })],
        actionStatus: null,
      }),
      handlers: chatHandlers(),
    }),
  );

  assert.match(
    html,
    /data-ai-generated="true"/,
    "the card article is machine-readably marked per Art. 50(2)",
  );
});

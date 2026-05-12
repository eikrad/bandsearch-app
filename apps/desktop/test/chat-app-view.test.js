const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const { ChatAppView } = require("../src/ui/ChatAppView");

test("ChatAppView renders mode, query input, cards, and action buttons", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: {
        headerTitle: "Bandsearch",
        headerSubtitle: "Niche recommendations",
        viewport: "desktop",
        modeValue: "fresh",
        modeOptions: [
          { value: "fresh", label: "Fresh search" },
          { value: "preference-aware", label: "Preference-aware" },
        ],
        queryPlaceholder: "Describe bands...",
        queryDisabled: false,
        cards: [
          {
            title: "Fen",
            why: "Atmospheric overlap",
            saved: true,
            rating: 4,
            country: "UK",
            genres: ["post-black"],
            connection: "Related to Alcest",
            actions: {
              save: { visible: true },
              rate: { visible: true },
              more: { visible: true },
            },
          },
        ],
        emptyText: "No recommendations yet.",
        actionStatus: { type: "success", message: "Saved Fen." },
      },
      handlers: {
        onModeChange: () => {},
        onQuerySubmit: () => {},
        onSave: () => {},
        onRate: () => {},
        onMore: () => {},
      },
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

test("RecommendationCard has CSS class for card styling", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: {
        headerTitle: "Bandsearch",
        headerSubtitle: "Niche recommendations",
        viewport: "desktop",
        modeValue: "fresh",
        modeOptions: [{ value: "fresh", label: "Fresh search" }],
        queryPlaceholder: "Describe bands...",
        queryDisabled: false,
        cards: [
          {
            title: "Fen",
            why: "Atmospheric post-metal",
            saved: false,
            rating: null,
            country: "UK",
            genres: ["post-black"],
            connection: "",
            actions: {
              save: { visible: true },
              rate: { visible: true },
              more: { visible: true },
            },
          },
        ],
        actionStatus: null,
      },
      handlers: {
        onModeChange: () => {},
        onQuerySubmit: () => {},
        onSave: () => {},
        onRate: () => {},
        onMore: () => {},
        onNavigateSettings: () => {},
        onNavigateSaved: () => {},
      },
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
      viewProps: {
        headerTitle: "Bandsearch",
        headerSubtitle: "Niche recommendations",
        viewport: "desktop",
        modeValue: "fresh",
        modeOptions: [{ value: "fresh", label: "Fresh search" }],
        queryPlaceholder: "Describe bands...",
        queryDisabled: true,
        isLoading: true,
        cards: [],
        emptyText: "No recommendations yet.",
      },
      handlers: {
        onModeChange: () => {},
        onQuerySubmit: () => {},
        onSave: () => {},
        onRate: () => {},
        onMore: () => {},
        onNavigateSettings: () => {},
        onNavigateSaved: () => {},
      },
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
      viewProps: {
        headerTitle: "Bandsearch",
        headerSubtitle: "Niche recommendations",
        viewport: "desktop",
        modeValue: "fresh",
        modeOptions: [{ value: "fresh", label: "Fresh" }],
        queryPlaceholder: "Describe bands...",
        queryDisabled: false,
        cards: [],
        messages: [
          { id: "m1", role: "user", content: "I like atmospheric bands" },
          {
            id: "m2",
            role: "assistant",
            content: "Here are picks in that vein — want something heavier or more shoegaze?",
            cards: [
              {
                title: "Fen",
                why: "Atmospheric overlap",
                genres: [],
                actions: { save: { visible: true }, rate: { visible: false }, more: { visible: false } },
              },
            ],
          },
        ],
      },
      handlers: {
        onModeChange: () => {},
        onQuerySubmit: () => {},
        onSave: () => {},
        onRate: () => {},
        onMore: () => {},
        onNavigateSettings: () => {},
        onNavigateSaved: () => {},
      },
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
      viewProps: {
        headerTitle: "Bandsearch",
        headerSubtitle: "Niche recommendations",
        viewport: "mobile",
        modeValue: "fresh",
        modeOptions: [{ value: "fresh", label: "Fresh search" }],
        queryPlaceholder: "Describe bands...",
        queryDisabled: false,
        cards: [],
        messages: [
          { id: "m1", role: "user", content: "I like atmospheric bands" },
          {
            id: "m2",
            role: "assistant",
            content: "Here are picks.",
            cards: [
              {
                title: "Fen",
                why: "Atmospheric overlap",
                genres: [],
                actions: { save: { visible: true }, rate: { visible: false }, more: { visible: false } },
              },
            ],
          },
        ],
      },
      handlers: {
        onModeChange: () => {},
        onQuerySubmit: () => {},
        onSave: () => {},
        onRate: () => {},
        onMore: () => {},
        onNavigateSettings: () => {},
        onNavigateSaved: () => {},
      },
    }),
  );

  assert.equal(html.includes("bandsearch-desktop-split"), false, "no split rail on mobile");
  assert.ok(html.includes("Fen"), "card stays inline in thread");
});

test("ChatAppView desktop collapses earlier recommendation turns (C)", () => {
  const cardProps = { genres: [], actions: { save: { visible: true }, rate: { visible: false }, more: { visible: false } } };
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: {
        headerTitle: "Bandsearch",
        headerSubtitle: "Niche recommendations",
        viewport: "desktop",
        modeValue: "fresh",
        modeOptions: [{ value: "fresh", label: "Fresh search" }],
        queryPlaceholder: "Describe bands...",
        queryDisabled: false,
        cards: [],
        messages: [
          { id: "u1", role: "user", content: "Round one" },
          {
            id: "a1",
            role: "assistant",
            content: "First suggestions.",
            cards: [{ title: "EarlierArtist", why: "Because", ...cardProps }],
          },
          { id: "u2", role: "user", content: "Round two" },
          {
            id: "a2",
            role: "assistant",
            content: "Latest suggestions.",
            cards: [{ title: "LatestArtist", why: "Fit", ...cardProps }],
          },
        ],
      },
      handlers: {
        onModeChange: () => {},
        onQuerySubmit: () => {},
        onSave: () => {},
        onRate: () => {},
        onMore: () => {},
        onNavigateSettings: () => {},
        onNavigateSaved: () => {},
      },
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
      viewProps: {
        headerTitle: "Bandsearch",
        headerSubtitle: "Niche recommendations",
        viewport: "desktop",
        modeValue: "fresh",
        modeOptions: [{ value: "fresh", label: "Fresh" }],
        queryPlaceholder: "Describe bands...",
        queryDisabled: false,
        cards: [
          {
            title: "Fen",
            genres: ["post-black"],
            imageUrl: "https://commons.wikimedia.org/fen.jpg",
            platformLinks: [],
            actions: { save: { visible: false }, rate: { visible: false }, more: { visible: false } },
          },
        ],
      },
      handlers: {
        onModeChange: () => {},
        onQuerySubmit: () => {},
        onSave: () => {},
        onRate: () => {},
        onMore: () => {},
        onNavigateSettings: () => {},
        onNavigateSaved: () => {},
      },
    }),
  );

  assert.equal(html.includes("https://commons.wikimedia.org/fen.jpg"), true, "image src rendered");
});

test("ChatAppView renders platform links when provided on card", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: {
        headerTitle: "Bandsearch",
        headerSubtitle: "Niche recommendations",
        viewport: "desktop",
        modeValue: "fresh",
        modeOptions: [{ value: "fresh", label: "Fresh" }],
        queryPlaceholder: "Describe bands...",
        queryDisabled: false,
        cards: [
          {
            title: "Fen",
            platformLinks: [
              { platform: "bandcamp", url: "https://bandcamp.com/search?q=Fen", label: "Bandcamp" },
              { platform: "spotify", url: "https://open.spotify.com/search/Fen", label: "Spotify" },
            ],
            actions: { save: { visible: false }, rate: { visible: false }, more: { visible: false } },
          },
        ],
      },
      handlers: {
        onModeChange: () => {},
        onQuerySubmit: () => {},
        onSave: () => {},
        onRate: () => {},
        onMore: () => {},
        onNavigateSettings: () => {},
        onNavigateSaved: () => {},
      },
    }),
  );

  assert.equal(html.includes("bandcamp.com"), true, "bandcamp link rendered");
  assert.equal(html.includes("spotify.com"), true, "spotify link rendered");
});

test("ChatAppView renders a Saved Artists navigation button", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: {
        headerTitle: "Bandsearch",
        headerSubtitle: "Niche recommendations",
        viewport: "desktop",
        modeValue: "fresh",
        modeOptions: [{ value: "fresh", label: "Fresh" }],
        queryPlaceholder: "Describe bands...",
        queryDisabled: false,
        cards: [],
      },
      handlers: {
        onModeChange: () => {},
        onQuerySubmit: () => {},
        onSave: () => {},
        onRate: () => {},
        onMore: () => {},
        onNavigateSettings: () => {},
        onNavigateSaved: () => {},
      },
    }),
  );

  assert.equal(html.includes("Saved") || html.includes("saved"), true, "has saved artists nav link");
});

test("ChatAppView renders a Settings navigation button", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: {
        headerTitle: "Bandsearch",
        headerSubtitle: "Niche recommendations",
        viewport: "desktop",
        modeValue: "fresh",
        modeOptions: [{ value: "fresh", label: "Fresh" }],
        queryPlaceholder: "Describe bands...",
        queryDisabled: false,
        cards: [],
      },
      handlers: {
        onModeChange: () => {},
        onQuerySubmit: () => {},
        onSave: () => {},
        onRate: () => {},
        onMore: () => {},
        onNavigateSettings: () => {},
        onNavigateSaved: () => {},
      },
    }),
  );

  assert.equal(html.includes("Settings"), true);
});

test("ChatAppView renders genre chips for cards with genres", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: {
        headerTitle: "Bandsearch",
        headerSubtitle: "Niche recommendations",
        viewport: "desktop",
        modeValue: "fresh",
        modeOptions: [{ value: "fresh", label: "Fresh" }],
        queryPlaceholder: "Describe bands...",
        queryDisabled: false,
        cards: [
          {
            title: "Wolves in the Throne Room",
            genres: ["atmospheric-black", "cascadian"],
            actions: { save: { visible: true }, rate: { visible: false }, more: { visible: false } },
          },
        ],
      },
      handlers: {
        onModeChange: () => {},
        onQuerySubmit: () => {},
        onSave: () => {},
        onRate: () => {},
        onMore: () => {},
      },
    }),
  );

  assert.equal(html.includes("atmospheric-black"), true, "first genre chip rendered");
  assert.equal(html.includes("cascadian"), true, "second genre chip rendered");
});

test("ChatAppView uses compact mobile layout and action density", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatAppView, {
      viewProps: {
        headerTitle: "Bandsearch",
        headerSubtitle: "Niche recommendations",
        viewport: "mobile",
        modeValue: "preference-aware",
        modeOptions: [{ value: "preference-aware", label: "Preference-aware" }],
        queryPlaceholder: "Describe bands...",
        queryDisabled: false,
        cards: [
          {
            title: "Alcest",
            why: "Dreamlike overlap",
            actions: {
              save: { visible: false },
              rate: { visible: false },
              more: { visible: true },
            },
          },
        ],
        emptyText: "No recommendations yet.",
      },
      handlers: {
        onModeChange: () => {},
        onQuerySubmit: () => {},
        onSave: () => {},
        onRate: () => {},
        onMore: () => {},
      },
    }),
  );

  assert.equal(html.includes("flex-direction:column"), true);
  assert.equal(html.includes("···"), true, "more button shows ···");
  // Save/Rate action buttons should not appear when not visible on the card
  // (Note: the header has a "Saved" nav button, so we check for the action button text only)
  assert.equal(html.includes(">Save<"), false, "card Save action not rendered");
  assert.equal(html.includes("Rate"), false);
});

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
  assert.equal(html.includes("More"), true);
  assert.equal(html.includes("saved · 4/5"), true);
  assert.equal(html.includes("Saved Fen."), true);
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
  assert.equal(html.includes("More"), true);
  assert.equal(html.includes("Save"), false);
  assert.equal(html.includes("Rate"), false);
});

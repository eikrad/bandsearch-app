const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const { SavedArtistsView } = require("../src/ui/SavedArtistsView");

const baseHandlers = {
  onNavigate: () => {},
  onDelete: () => {},
};

test("SavedArtistsView renders each saved artist name", () => {
  const html = renderToStaticMarkup(
    React.createElement(SavedArtistsView, {
      viewProps: {
        header: { title: "Saved Artists", subtitle: "Your style references" },
        artists: [
          { id: "b1", name: "Fen", rating: 4, categoryTags: ["post-black"], note: "", isSelected: false },
          { id: "b2", name: "Alcest", rating: 5, categoryTags: [], note: "", isSelected: false },
        ],
        isLoading: false,
      },
      handlers: baseHandlers,
    }),
  );

  assert.equal(html.includes("Fen"), true);
  assert.equal(html.includes("Alcest"), true);
});

test("SavedArtistsView renders empty state when no artists", () => {
  const html = renderToStaticMarkup(
    React.createElement(SavedArtistsView, {
      viewProps: {
        header: { title: "Saved Artists", subtitle: "Your style references" },
        artists: [],
        isLoading: false,
      },
      handlers: baseHandlers,
    }),
  );

  assert.equal(html.includes("Saved Artists"), true);
  assert.equal(html.includes("No saved artists"), true);
});

test("SavedArtistsView renders navigation back to chat", () => {
  const html = renderToStaticMarkup(
    React.createElement(SavedArtistsView, {
      viewProps: {
        header: { title: "Saved Artists", subtitle: "Your style references" },
        artists: [],
        isLoading: false,
      },
      handlers: baseHandlers,
    }),
  );

  assert.equal(html.includes("Recommendations") || html.includes("Back"), true);
});

test("SavedArtistsView renders Saved Artists heading", () => {
  const html = renderToStaticMarkup(
    React.createElement(SavedArtistsView, {
      viewProps: {
        header: { title: "Saved Artists", subtitle: "Your style references" },
        artists: [],
        isLoading: false,
      },
      handlers: baseHandlers,
    }),
  );

  assert.equal(html.includes("Saved Artists"), true);
});

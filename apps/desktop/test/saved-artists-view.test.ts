import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SavedArtistsView } from "../src/ui/SavedArtistsView.js";

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

test("SavedArtistsView renders search input and button", () => {
  const html = renderToStaticMarkup(
    React.createElement(SavedArtistsView, {
      viewProps: {
        header: { title: "Saved Artists", subtitle: "Your style references" },
        artists: [],
        isLoading: false,
        searchResults: [],
        isSearching: false,
      },
      handlers: baseHandlers,
    }),
  );

  assert.equal(html.includes('name="artist-search"'), true, "should render search input");
  assert.equal(html.includes("Search"), true, "should render Search button");
});

test("SavedArtistsView renders search results with Add buttons", () => {
  const html = renderToStaticMarkup(
    React.createElement(SavedArtistsView, {
      viewProps: {
        header: { title: "Saved Artists", subtitle: "Your style references" },
        artists: [],
        isLoading: false,
        searchResults: [{ id: "abc", name: "Alcest", disambiguation: "French blackgaze" }],
        isSearching: false,
      },
      handlers: { ...baseHandlers, onAddArtist: () => {} },
    }),
  );

  assert.equal(html.includes("Alcest"), true, "should show search result name");
  assert.equal(html.includes("French blackgaze"), true, "should show disambiguation");
  assert.equal(html.includes("Add"), true, "should render Add button per result");
});

test("SavedArtistsView renders tick button per artist", () => {
  const html = renderToStaticMarkup(
    React.createElement(SavedArtistsView, {
      viewProps: {
        header: { title: "Saved Artists", subtitle: "Your style references" },
        artists: [{ id: "b1", name: "Fen", rating: 4, categoryTags: [], note: "", isSelected: false }],
        isLoading: false,
        searchResults: [],
        isSearching: false,
        selectedCount: 0,
      },
      handlers: { ...baseHandlers, onToggleSelection: () => {} },
    }),
  );

  assert.equal(html.includes("tick-btn"), true, "should render element with tick-btn class");
  assert.equal(html.includes("○"), true, "unselected tick should show empty circle");
});

test("SavedArtistsView renders checkmark for selected artist", () => {
  const html = renderToStaticMarkup(
    React.createElement(SavedArtistsView, {
      viewProps: {
        header: { title: "Saved Artists", subtitle: "Your style references" },
        artists: [{ id: "b1", name: "Fen", rating: 4, categoryTags: [], note: "", isSelected: true }],
        isLoading: false,
        searchResults: [],
        isSearching: false,
        selectedCount: 1,
      },
      handlers: { ...baseHandlers, onToggleSelection: () => {}, onActivateStyleRef: () => {} },
    }),
  );

  assert.equal(html.includes("✓"), true, "selected tick should show checkmark");
  assert.equal(html.includes("○"), false, "selected artist should not show empty circle");
});

test("SavedArtistsView shows loading state when isLoading", () => {
  const html = renderToStaticMarkup(
    React.createElement(SavedArtistsView, {
      viewProps: {
        header: { title: "Saved Artists", subtitle: "Your style references" },
        artists: [],
        isLoading: true,
        searchResults: [],
        isSearching: false,
        selectedCount: 0,
      },
      handlers: baseHandlers,
    }),
  );

  assert.equal(html.includes("Loading"), true, "should show loading indicator");
  assert.equal(html.includes("No saved artists"), false, "should not show empty state while loading");
});

test("SavedArtistsView shows selection bar when selectedCount > 0", () => {
  const html = renderToStaticMarkup(
    React.createElement(SavedArtistsView, {
      viewProps: {
        header: { title: "Saved Artists", subtitle: "Your style references" },
        artists: [{ id: "b1", name: "Fen", rating: 4, categoryTags: [], note: "", isSelected: true }],
        isLoading: false,
        searchResults: [],
        isSearching: false,
        selectedCount: 1,
      },
      handlers: { ...baseHandlers, onToggleSelection: () => {}, onActivateStyleRef: () => {} },
    }),
  );

  assert.equal(html.includes("1 selected"), true, "should show selected count in selection bar");
});

test("SavedArtistsView shows searching indicator when isSearching", () => {
  const html = renderToStaticMarkup(
    React.createElement(SavedArtistsView, {
      viewProps: {
        header: { title: "Saved Artists", subtitle: "Your style references" },
        artists: [],
        isLoading: false,
        searchResults: [],
        isSearching: true,
      },
      handlers: baseHandlers,
    }),
  );

  assert.equal(html.includes("Searching"), true, "should show searching indicator");
});

test("SavedArtistsView renders Export button", () => {
  const html = renderToStaticMarkup(
    React.createElement(SavedArtistsView, {
      viewProps: {
        header: { title: "Saved Artists", subtitle: "Your style references" },
        artists: [],
        isLoading: false,
        searchResults: [],
        isSearching: false,
      },
      handlers: { ...baseHandlers, onExport: () => {} },
    }),
  );

  assert.equal(html.includes("Export"), true, "should render Export button");
});

test("SavedArtistsView renders group sections when groups provided", () => {
  const html = renderToStaticMarkup(
    React.createElement(SavedArtistsView, {
      viewProps: {
        header: { title: "Saved Artists", subtitle: "Your style references" },
        artists: [{ id: "b1", name: "Alcest", rating: 5, categoryTags: [], note: "", isSelected: false }],
        groups: [{ id: "g1", name: "Blackgaze", memberIds: ["b1"] }],
        isLoading: false,
        searchResults: [],
        isSearching: false,
      },
      handlers: { ...baseHandlers },
    }),
  );

  assert.equal(html.includes("Blackgaze"), true, "should render group name");
});

test("SavedArtistsView renders Group by genre button", () => {
  const html = renderToStaticMarkup(
    React.createElement(SavedArtistsView, {
      viewProps: {
        header: { title: "Saved Artists", subtitle: "Your style references" },
        artists: [],
        groups: [],
        isLoading: false,
        searchResults: [],
        isSearching: false,
      },
      handlers: { ...baseHandlers, onAutoGroup: () => {} },
    }),
  );

  assert.equal(html.includes("Group by genre"), true, "should render Group by genre button");
});

test("SavedArtistsView renders create group input", () => {
  const html = renderToStaticMarkup(
    React.createElement(SavedArtistsView, {
      viewProps: {
        header: { title: "Saved Artists", subtitle: "Your style references" },
        artists: [],
        groups: [],
        isLoading: false,
        searchResults: [],
        isSearching: false,
      },
      handlers: { ...baseHandlers, onCreateGroup: () => {} },
    }),
  );

  assert.equal(html.includes("create-group"), true, "should render create group input or form");
});

test("SavedArtistsView renders Import file input", () => {
  const html = renderToStaticMarkup(
    React.createElement(SavedArtistsView, {
      viewProps: {
        header: { title: "Saved Artists", subtitle: "Your style references" },
        artists: [],
        isLoading: false,
        searchResults: [],
        isSearching: false,
      },
      handlers: { ...baseHandlers, onImport: () => {} },
    }),
  );

  assert.equal(html.includes("Import"), true, "should render Import button or label");
});

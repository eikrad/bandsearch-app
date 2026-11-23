import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SettingsView } from "../src/ui/SettingsView.js";
import { setLanguage, type Language } from "../src/i18n/i18n.js";
import { findElement } from "./helpers/fakeDom.js";

const noStorage = null;

function render(onLanguageChange?: (language: Language) => void) {
  return SettingsView({ viewProps: { hasStoredKey: true, hasBraveKey: true }, handlers: { onLanguageChange } });
}

test("Settings offers every language, each named in itself, and marks the current one", async () => {
  await setLanguage("de", noStorage);
  try {
    const html = renderToStaticMarkup(React.createElement(SettingsView, { viewProps: {}, handlers: {} }));
    for (const name of ["English", "Deutsch", "Dansk"]) assert.ok(html.includes(`>${name}<`), name);
    assert.match(html, /aria-pressed="true"[^>]*>Deutsch</);
    assert.doesNotMatch(html, /aria-pressed="true"[^>]*>English</);
  } finally {
    await setLanguage("en", noStorage);
  }
});

test("choosing a language in Settings asks for that language", () => {
  const chosen: Language[] = [];
  const tree = render((language) => chosen.push(language));
  // The card is its own component inside Settings; render it to reach its buttons.
  const card = findElement(tree, (el) => typeof el.type === "function" && el.type.name === "LanguageCard");
  assert.ok(card, "a language card");
  const cardTree = (card.type as (props: unknown) => unknown)(card.props);
  const button = findElement(cardTree, (el) => (el.props as { children?: unknown }).children === "Dansk");
  assert.ok(button, "a Dansk button");
  (button.props as { onClick: () => void }).onClick();
  assert.deepEqual(chosen, ["da"]);
});

test("the language card says that chat replies follow the language the user writes in", () => {
  const html = renderToStaticMarkup(React.createElement(SettingsView, { viewProps: {}, handlers: {} }));
  assert.match(html, /Chat replies follow the language you write in\./);
});

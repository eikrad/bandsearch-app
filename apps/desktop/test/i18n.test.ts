import test from "node:test";
import i18next from "i18next";
import assert from "node:assert/strict";

import {
  SUPPORTED_LANGUAGES,
  LANGUAGE_NAMES,
  detectLanguage,
  chooseInitialLanguage,
  setLanguage,
  currentLanguage,
  t,
  formatList,
  formatDate,
  formatNumber,
} from "../src/i18n/i18n.js";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

test("Bandsearch speaks English, German and Danish, each named in its own language", () => {
  assert.deepEqual([...SUPPORTED_LANGUAGES], ["en", "de", "da"]);
  assert.deepEqual(LANGUAGE_NAMES, { en: "English", de: "Deutsch", da: "Dansk" });
});

test("the app starts in the system's language when Bandsearch speaks it", () => {
  assert.equal(detectLanguage(["de-DE", "en-US"]), "de");
  assert.equal(detectLanguage(["fr-FR", "da"]), "da", "the first supported one in the system's order");
  assert.equal(detectLanguage(["nb-NO", "fr"]), "en", "English when none is supported");
  assert.equal(detectLanguage([]), "en");
});

test("a language the user chose wins over the system's, and a broken stored value is ignored", () => {
  assert.equal(chooseInitialLanguage({ stored: "da", system: ["de-DE"] }), "da");
  assert.equal(chooseInitialLanguage({ stored: "klingon", system: ["de-DE"] }), "de");
  assert.equal(chooseInitialLanguage({ stored: null, system: ["en-GB"] }), "en");
});

test("choosing a language switches the text and is remembered for the next start", async () => {
  const storage = memoryStorage();
  try {
    await setLanguage("da", storage);
    assert.equal(currentLanguage(), "da");
    assert.equal(storage.data.get("bandsearch.language"), "da");
  } finally {
    await setLanguage("en", memoryStorage());
  }
});

test("a key with no text in the chosen language falls back to English", async () => {
  // A key only English has, as when a new string has not been translated yet.
  i18next.addResource("en", "translation", "testOnly.newText", "Only in English so far");
  try {
    await setLanguage("da", memoryStorage());
    assert.equal(t("testOnly.newText" as never), "Only in English so far");
  } finally {
    await setLanguage("en", memoryStorage());
  }
});

test("a key the English catalog does not have is a type error", () => {
  // @ts-expect-error a missing key must fail the typecheck (#329)
  t("common.thisKeyDoesNotExist");
});

test("lists, dates and numbers follow the chosen language", async () => {
  try {
    await setLanguage("de", memoryStorage());
    assert.equal(formatList(["Scaleway", "Brave Search"]), "Scaleway und Brave Search");
    assert.equal(formatDate("2026-11-18"), "18. November 2026");
    assert.equal(formatNumber(12500), "12.500");
    await setLanguage("en", memoryStorage());
    assert.equal(formatList(["Scaleway", "Brave Search"]), "Scaleway and Brave Search");
    assert.equal(formatDate("2026-11-18"), "November 18, 2026");
    assert.equal(formatNumber(12500), "12,500");
  } finally {
    await setLanguage("en", memoryStorage());
  }
});

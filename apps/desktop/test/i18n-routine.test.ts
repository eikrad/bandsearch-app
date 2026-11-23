import test from "node:test";
import assert from "node:assert/strict";

import {
  checkCatalog,
  flatten,
  keysToTranslate,
  sourceHash,
  unflatten,
  type Glossary,
  type ReviewState,
} from "../scripts/i18n/catalog.js";
import { translateCatalog } from "../scripts/i18n/translate.js";

/**
 * The translation routine of #329 step D: English is the source, German and
 * Danish are drafted by a model, every draft waits for a person, and a check
 * keeps the catalogs whole.
 */

const EN = { login: { title: "Sign in", failed: "login failed" }, saved: { count_one: "{{count}} artist", count_other: "{{count}} artists" } };
const GLOSSARY: Glossary = {
  style: { de: "Address the user as du.", da: "Address the user as du." },
  terms: [
    { en: "artist", de: { text: "Künstler", status: "reviewed" }, da: { text: "kunstner", status: "draft" } },
    { en: "MusicBrainz", keep: true },
  ],
};

const reviewed = (en: string): ReviewState[string] => ({ status: "reviewed", source: sourceHash(en) });
const draft = (en: string): ReviewState[string] => ({ status: "draft", source: sourceHash(en) });

test("a catalog flattens to dotted keys and back in the source's order", () => {
  const flat = flatten(EN);
  assert.deepEqual(Object.keys(flat), ["login.title", "login.failed", "saved.count_one", "saved.count_other"]);
  assert.deepEqual(unflatten(flat), EN);
});

test("only missing, new and changed strings are translated; a reviewed one is kept until its English changes", () => {
  const en = flatten(EN);
  const target = { "login.title": "Anmelden", "login.failed": "Anmeldung fehlgeschlagen", "saved.count_one": "{{count}} Künstler" };
  const review: ReviewState = {
    "login.title": reviewed("Sign in"),
    "login.failed": reviewed("sign-in failed"),
    "saved.count_one": draft("{{count}} artist"),
  };
  assert.deepEqual(keysToTranslate(en, target, review), ["login.failed", "saved.count_other"]);
});

test("the check fails on missing and stray keys, broken placeholders and missing plural forms", () => {
  const { errors } = checkCatalog("de", flatten(EN), { "login.title": "Anmelden", "saved.count_one": "Künstler", "old.key": "x" }, {}, GLOSSARY);
  assert.ok(errors.some((e) => e.includes("login.failed") && /missing/.test(e)));
  assert.ok(errors.some((e) => e.includes("saved.count_other") && /missing/.test(e)));
  assert.ok(errors.some((e) => e.includes("saved.count_one") && /placeholder/.test(e)));
  assert.ok(errors.some((e) => e.includes("old.key") && /not in the English/.test(e)));
});

test("the check fails when a translation does not use the glossary's word, and keeps names as they are", () => {
  const en = { a: "Add artist", b: "Search MusicBrainz…" };
  const { errors } = checkCatalog("de", en, { a: "Interpret hinzufügen", b: "MusikBrainz durchsuchen…" }, { a: draft("Add artist"), b: draft("Search MusicBrainz…") }, GLOSSARY);
  assert.ok(errors.some((e) => e.includes("a:") && e.includes("Künstler")));
  assert.ok(errors.some((e) => e.includes("b:") && e.includes("MusicBrainz")));
  const ok = checkCatalog("de", en, { a: "Künstler hinzufügen", b: "MusicBrainz durchsuchen…" }, { a: draft("Add artist"), b: draft("Search MusicBrainz…") }, GLOSSARY);
  assert.deepEqual(ok.errors, []);
});

test("an English text changed since its translation fails the check, and drafts are counted as a warning", () => {
  const { errors } = checkCatalog("de", { a: "Sign in now" }, { a: "Anmelden" }, { a: reviewed("Sign in") }, GLOSSARY);
  assert.ok(errors.some((e) => e.includes("a:") && /changed/.test(e)));
  const drafts = checkCatalog("de", { a: "Sign in" }, { a: "Anmelden" }, { a: draft("Sign in") }, GLOSSARY);
  assert.deepEqual(drafts.errors, []);
  assert.ok(drafts.warnings.some((w) => /1 draft/.test(w)));
});

test("translating sends only what needs it, marks the results as drafts and leaves reviewed strings alone", async () => {
  const asked: string[][] = [];
  const result = await translateCatalog({
    language: "de",
    en: flatten(EN),
    target: { "login.title": "Anmelden" },
    review: { "login.title": reviewed("Sign in") },
    glossary: GLOSSARY,
    usedIn: () => [],
    translate: async (batch) => {
      asked.push(batch.map((item) => item.key));
      return Object.fromEntries(batch.map((item) => [item.key, `DE:${item.text}`]));
    },
  });
  assert.deepEqual(asked.flat(), ["login.failed", "saved.count_one", "saved.count_other"]);
  assert.equal(result.target["login.title"], "Anmelden");
  assert.equal(result.target["saved.count_other"], "DE:{{count}} artists");
  assert.deepEqual(result.review["login.failed"], draft("login failed"));
  assert.deepEqual(result.review["login.title"], reviewed("Sign in"));
});

test("a draft that loses a placeholder is not written; the key stays untranslated and is reported", async () => {
  const result = await translateCatalog({
    language: "da",
    en: { greet: "Hello {{name}}" },
    target: {},
    review: {},
    glossary: GLOSSARY,
    usedIn: () => [],
    translate: async () => ({ greet: "Hej" }),
  });
  assert.equal(result.target.greet, undefined);
  assert.ok(result.rejected.some((r) => r.key === "greet" && /placeholder/.test(r.reason)));
});

import { reviewQueue, applyDecision } from "../scripts/i18n/review.js";

test("review starts with the glossary, then walks the drafts in the English order", () => {
  const en = { "a.first": "Add artist", "b.second": "Sign in", "c.third": "Cancel" };
  const target = { "a.first": "Künstler hinzufügen", "b.second": "Anmelden", "c.third": "Abbrechen" };
  const review: ReviewState = { "a.first": draft("Add artist"), "b.second": reviewed("Sign in"), "c.third": draft("Cancel") };
  const glossary: Glossary = { ...GLOSSARY, terms: [{ en: "artist", de: { text: "Künstler", status: "draft" }, da: { text: "kunstner", status: "draft" } }] };
  const queue = reviewQueue("de", en, target, review, glossary);
  assert.deepEqual(queue.map((item) => (item.kind === "term" ? `term:${item.term}` : item.key)), ["term:artist", "a.first", "c.third"]);
});

test("accepting marks a string reviewed, editing stores the person's text as reviewed, rejecting removes the draft", () => {
  const state = { target: { a: "Anmelden", b: "Abbrechen", c: "Schlecht" }, review: { a: draft("Sign in"), b: draft("Cancel"), c: draft("Bad") } };
  applyDecision(state, { kind: "string", key: "a", source: "Sign in" }, { action: "accept" });
  applyDecision(state, { kind: "string", key: "b", source: "Cancel" }, { action: "edit", text: "Abbruch" });
  applyDecision(state, { kind: "string", key: "c", source: "Bad" }, { action: "reject" });
  assert.deepEqual(state.review.a, reviewed("Sign in"));
  assert.equal(state.target.b, "Abbruch");
  assert.deepEqual(state.review.b, reviewed("Cancel"));
  assert.equal(state.target.c, undefined, "a rejected draft is gone, so the next translate run drafts it again");
  assert.equal(state.review.c, undefined);
});

import { checkShippedCatalogs } from "../scripts/i18n/check.js";

test("the catalogs the app ships are whole: every key, every placeholder, the glossary's words", () => {
  for (const { language, errors, warnings } of checkShippedCatalogs()) {
    assert.deepEqual(errors, [], `${language}: npm run i18n:check -w @bandsearch/desktop`);
    // Drafts are allowed (owner decision); they stay visible here and in i18n:check.
    for (const warning of warnings) console.log(`i18n ${language}: ${warning}`);
  }
});

test("a draft that misses the glossary's word is drafted again; a reviewed one is left to the person", async () => {
  const asked: string[] = [];
  await translateCatalog({
    language: "da",
    en: { a: "Add artist", b: "Remove artist" },
    target: { a: "Tilføj musiker", b: "Fjern musiker" },
    review: { a: draft("Add artist"), b: reviewed("Remove artist") },
    glossary: GLOSSARY,
    usedIn: () => [],
    translate: async (batch) => {
      asked.push(...batch.map((item) => item.key));
      return Object.fromEntries(batch.map((item) => [item.key, "Tilføj kunstner"]));
    },
  });
  assert.deepEqual(asked, ["a"]);
});

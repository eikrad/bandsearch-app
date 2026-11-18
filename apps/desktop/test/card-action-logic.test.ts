import test from "node:test";
import assert from "node:assert/strict";
import {
  nextRatingForStarTap,
  parseCategoriesInput,
  startCategoryNoteDraft,
  editNote,
  editCategories,
  categoryNoteUpdates,
} from "../src/cardActionLogic.js";

test("tapping an unrated card at star n rates it n", () => {
  assert.equal(nextRatingForStarTap(null, 4), 4);
});

test("tapping a different star than the current rating replaces it", () => {
  assert.equal(nextRatingForStarTap(3, 5), 5);
});

test("tapping the currently active star clears the rating", () => {
  assert.equal(nextRatingForStarTap(4, 4), null);
});

test("parseCategoriesInput trims and drops blanks", () => {
  assert.deepEqual(parseCategoriesInput(" blackgaze ,  , shoegaze,"), ["blackgaze", "shoegaze"]);
});

test("parseCategoriesInput on an empty string is an empty list", () => {
  assert.deepEqual(parseCategoriesInput(""), []);
});

// ---------------------------------------------------------------------------
// The Category/Note sheet's draft (ADR 0002, #310). Sending `note` at all marks
// it as the user's own words, and only those reach the recommendation prompt.
// So the rule is: a note the user never touched is never sent.
// ---------------------------------------------------------------------------

const aiSuggested = { categories: ["slowcore"], note: "Sparse, glacial guitars.", noteEdited: false };

test("an untouched sheet sends nothing, so an AI-suggested note stays out of the prompt", () => {
  assert.deepEqual(categoryNoteUpdates(startCategoryNoteDraft(aiSuggested)), {});
});

test("editing the note sends it, which marks it as the user's own", () => {
  const draft = editNote(startCategoryNoteDraft(aiSuggested), "Sparse, glacial guitars. Saw them live.");
  assert.deepEqual(categoryNoteUpdates(draft), { note: "Sparse, glacial guitars. Saw them live." });
});

test("a touched note is sent even when cleared or typed back to the original", () => {
  const cleared = editNote(startCategoryNoteDraft(aiSuggested), "");
  assert.deepEqual(categoryNoteUpdates(cleared), { note: "" });
  const restored = editNote(editNote(startCategoryNoteDraft(aiSuggested), "x"), aiSuggested.note);
  assert.deepEqual(categoryNoteUpdates(restored), { note: aiSuggested.note });
});

test("editing only the categories sends them parsed and leaves the note out", () => {
  const draft = editCategories(startCategoryNoteDraft(aiSuggested), " slowcore, , sadcore ");
  assert.deepEqual(categoryNoteUpdates(draft), { categories: ["slowcore", "sadcore"] });
});

test("editing both sends both", () => {
  const draft = editNote(editCategories(startCategoryNoteDraft(aiSuggested), "sadcore"), "Mine now.");
  assert.deepEqual(categoryNoteUpdates(draft), { categories: ["sadcore"], note: "Mine now." });
});

test("the draft starts from the card's values", () => {
  const draft = startCategoryNoteDraft({ categories: ["slowcore", "sadcore"], note: "Mine.", noteEdited: true });
  assert.equal(draft.categoriesText, "slowcore, sadcore");
  assert.equal(draft.note, "Mine.");
});

test("only a non-empty note the user never edited is labelled AI-suggested", () => {
  assert.equal(startCategoryNoteDraft(aiSuggested).noteIsAiSuggested, true);
  assert.equal(startCategoryNoteDraft({ ...aiSuggested, noteEdited: true }).noteIsAiSuggested, false);
  assert.equal(startCategoryNoteDraft({ ...aiSuggested, note: "" }).noteIsAiSuggested, false);
});

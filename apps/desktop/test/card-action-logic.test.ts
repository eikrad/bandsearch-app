import test from "node:test";
import assert from "node:assert/strict";
import { nextRatingForStarTap, parseCategoriesInput } from "../src/cardActionLogic.js";

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

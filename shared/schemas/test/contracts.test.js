const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateRecommendationItem,
  validateSavedBand,
  validateRecommendationMode,
} = require("../src/contracts");

test("validateRecommendationItem accepts expected shape", () => {
  const result = validateRecommendationItem({
    artist: "Alcest",
    why: "Atmospheric and melancholic overlap",
    sourceSignals: ["musicbrainz_search"],
  });

  assert.equal(result.ok, true);
});

test("validateRecommendationItem rejects missing sourceSignals", () => {
  const result = validateRecommendationItem({
    artist: "Alcest",
    why: "Atmospheric and melancholic overlap",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "sourceSignals must be a string array");
});

test("validateSavedBand accepts valid rating and fields", () => {
  const result = validateSavedBand({
    musicbrainzArtistId: "a1",
    name: "Alcest",
    rating: 5,
    categories: ["blackgaze"],
    note: "Dreamy textures.",
  });

  assert.equal(result.ok, true);
});

test("validateRecommendationMode defaults to fresh", () => {
  assert.equal(validateRecommendationMode(undefined), "fresh");
  assert.equal(validateRecommendationMode("invalid"), "fresh");
  assert.equal(validateRecommendationMode("preference-aware"), "preference-aware");
});

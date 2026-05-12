const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateRecommendationItem,
  validateSavedBand,
  validateRecommendationMode,
  validateRecommendationHttpBody,
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

test("validateRecommendationItem accepts optional musicbrainzArtistId", () => {
  const result = validateRecommendationItem({
    artist: "Alcest",
    why: "Because",
    sourceSignals: ["musicbrainz_search"],
    musicbrainzArtistId: "mbid-123",
  });
  assert.equal(result.ok, true);
});

test("validateRecommendationHttpBody normalizes recommendation POST body", () => {
  const v = validateRecommendationHttpBody({
    query: "  dark ambient  ",
    mode: "preference-aware",
    selectedArtistIds: ["a", "b"],
    priorityContext: " note ",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(v.ok, true);
  assert.equal(v.query, "dark ambient");
  assert.equal(v.mode, "preference-aware");
  assert.deepEqual(v.selectedArtistIds, ["a", "b"]);
  assert.equal(v.priorityContext, "note");
  assert.equal(v.messages.length, 1);
});

test("validateRecommendationHttpBody rejects invalid messages", () => {
  const v = validateRecommendationHttpBody({
    query: "x",
    messages: [{ role: "system", content: "no" }],
  });
  assert.equal(v.ok, false);
});

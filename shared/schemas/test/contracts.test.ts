import assert from "node:assert/strict";
import test from "node:test";
import {
  MESSAGE_CONTENT_MAX_LEN,
  MESSAGES_MAX_COUNT,
  PRIORITY_CONTEXT_MAX_LEN,
  QUERY_MAX_LENGTH,
  validateRecommendationItem,
  validateRecommendationHttpBody,
  validateRecommendationMode,
  validateSavedBand,
} from "../src/contracts.js";

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

test("validateRecommendationHttpBody rejects query longer than QUERY_MAX_LENGTH", () => {
  const v = validateRecommendationHttpBody({ query: "a".repeat(QUERY_MAX_LENGTH + 1) });
  assert.equal(v.ok, false);
  assert.equal(v.error, "query too long");
});

test("validateRecommendationHttpBody rejects message content longer than MESSAGE_CONTENT_MAX_LEN", () => {
  const v = validateRecommendationHttpBody({
    query: "dark ambient",
    messages: [{ role: "user", content: "x".repeat(MESSAGE_CONTENT_MAX_LEN + 1) }],
  });
  assert.equal(v.ok, false);
  assert.equal(v.error, "message content too long");
});

test("validateRecommendationHttpBody rejects messages array over MESSAGES_MAX_COUNT", () => {
  const msgs = Array.from({ length: MESSAGES_MAX_COUNT + 1 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: "hi",
  }));
  const v = validateRecommendationHttpBody({ query: "dark ambient", messages: msgs });
  assert.equal(v.ok, false);
  assert.equal(v.error, "too many messages");
});

test("validateRecommendationHttpBody silently truncates priorityContext over PRIORITY_CONTEXT_MAX_LEN", () => {
  const v = validateRecommendationHttpBody({
    query: "dark ambient",
    priorityContext: "b".repeat(PRIORITY_CONTEXT_MAX_LEN + 100),
  });
  assert.equal(v.ok, true);
  assert.equal(v.priorityContext.length, PRIORITY_CONTEXT_MAX_LEN);
});

// ─── Phase 8.3: obscurityTarget ────────────────────────────────────────────

test("validateRecommendationHttpBody accepts valid obscurityTarget values", () => {
  for (const target of ["cult", "underground", "obscure"]) {
    const v = validateRecommendationHttpBody({ query: "dark ambient", obscurityTarget: target });
    assert.equal(v.ok, true);
    assert.equal(v.obscurityTarget, target, `expected ${target} to be passed through`);
  }
});

test("validateRecommendationHttpBody silently drops invalid obscurityTarget", () => {
  const v = validateRecommendationHttpBody({ query: "dark ambient", obscurityTarget: "mainstream" });
  assert.equal(v.ok, true);
  assert.equal(v.obscurityTarget, undefined, "invalid target should be silently dropped");
});

test("validateRecommendationHttpBody leaves obscurityTarget undefined when omitted", () => {
  const v = validateRecommendationHttpBody({ query: "dark ambient" });
  assert.equal(v.ok, true);
  assert.equal(v.obscurityTarget, undefined);
});

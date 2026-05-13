const test = require("node:test");
const assert = require("node:assert/strict");

const {
  tryParseReflectionFromModelText,
  createRecommendationReflector,
} = require("../../src/agent/research/recommendationReflector");

test("tryParseReflectionFromModelText caps extraQueries", () => {
  const raw = JSON.stringify({
    sufficient: false,
    gaps: ["too few"],
    extraQueries: ["a", "b", "c", "d", "e"],
  });
  const out = tryParseReflectionFromModelText(raw, 2);
  assert.equal(out.extraQueries.length, 2);
  assert.deepEqual(out.extraQueries, ["a", "b"]);
});

test("tryParseReflectionFromModelText rejects invalid shape", () => {
  assert.equal(tryParseReflectionFromModelText("{}", 4), null);
});

test("createRecommendationReflector rejects empty apiKey", async () => {
  await assert.rejects(() => createRecommendationReflector({ apiKey: "" }), /apiKey is required/);
});

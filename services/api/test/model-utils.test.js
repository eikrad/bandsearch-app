const test = require("node:test");
const assert = require("node:assert/strict");

const { parseModelJsonResponse, withTimeout } = require("../src/agent/modelUtils");

// ── parseModelJsonResponse ─────────────────────────────────────────────────

test("parseModelJsonResponse parses clean JSON object", () => {
  const result = parseModelJsonResponse('{"artist":"Alcest","why":"Atmospheric"}');
  assert.deepEqual(result, { artist: "Alcest", why: "Atmospheric" });
});

test("parseModelJsonResponse parses clean JSON array", () => {
  const result = parseModelJsonResponse('[{"artist":"Alcest"},{"artist":"Deafheaven"}]');
  assert.deepEqual(result, [{ artist: "Alcest" }, { artist: "Deafheaven" }]);
});

test("parseModelJsonResponse strips markdown code fences", () => {
  const result = parseModelJsonResponse('```json\n{"artist":"Alcest"}\n```');
  assert.deepEqual(result, { artist: "Alcest" });
});

test("parseModelJsonResponse extracts first JSON object from text with preamble", () => {
  const result = parseModelJsonResponse('Here are my picks: {"recommendations":[{"artist":"Alcest"}]}');
  assert.deepEqual(result, { recommendations: [{ artist: "Alcest" }] });
});

test("parseModelJsonResponse extracts JSON array from text with preamble", () => {
  const result = parseModelJsonResponse('Sure! [{"artist":"Alcest"}] enjoy!');
  assert.deepEqual(result, [{ artist: "Alcest" }]);
});

test("parseModelJsonResponse throws on unparseable input", () => {
  assert.throws(
    () => parseModelJsonResponse("not json at all"),
    /invalid recommendation output/,
  );
});

// ── withTimeout ────────────────────────────────────────────────────────────

test("withTimeout resolves when promise settles before timeout", async () => {
  const result = await withTimeout(Promise.resolve("ok"), 1000);
  assert.equal(result, "ok");
});

test("withTimeout rejects when timeout fires first", async () => {
  const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 200));
  await assert.rejects(withTimeout(slow, 10), /timeout/i);
});

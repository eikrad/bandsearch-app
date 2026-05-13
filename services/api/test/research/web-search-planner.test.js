const test = require("node:test");
const assert = require("node:assert/strict");

const {
  tryParseSearchPlanFromModelText,
  fallbackSearchPlan,
  createWebSearchPlanner,
} = require("../../src/agent/research/webSearchPlanner");

test("tryParseSearchPlanFromModelText reads queries array", () => {
  const raw = '{"anchorArtists":["Grade"],"styleSignals":["hardcore"],"mustHave":[],"avoid":[],"queries":["a","b"]}';
  const plan = tryParseSearchPlanFromModelText(raw);
  assert.equal(plan.queries.length, 2);
  assert.deepEqual(plan.anchorArtists, ["Grade"]);
});

test("tryParseSearchPlanFromModelText returns null without queries", () => {
  assert.equal(
    tryParseSearchPlanFromModelText('{"anchorArtists":[],"queries":[]}'),
    null,
  );
});

test("fallbackSearchPlan yields one sanitized query", () => {
  const plan = fallbackSearchPlan("I want newer punk");
  assert.ok(plan.queries.length >= 1);
  assert.match(plan.queries[0], /newer punk/i);
});

test("createWebSearchPlanner rejects empty apiKey", async () => {
  await assert.rejects(() => createWebSearchPlanner({ apiKey: "  " }), /apiKey is required/);
});

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

// ─── Phase 8.3: obscurityTarget constraint ─────────────────────────────────

test("buildPlannerUserContent includes obscurity constraint when obscurityTarget is set", () => {
  const { buildPlannerUserContentForTest } = require("../../src/agent/research/webSearchPlanner");
  const content = buildPlannerUserContentForTest({
    userQuery: "blackgaze bands",
    obscurityTarget: "underground",
  });
  assert.match(content, /underground/i, "prompt should mention the obscurity target");
  assert.match(content, /obscurity|niche|listener/i, "prompt should contain an obscurity constraint");
});

test("buildPlannerUserContent omits obscurity constraint when obscurityTarget is not set", () => {
  const { buildPlannerUserContentForTest } = require("../../src/agent/research/webSearchPlanner");
  const content = buildPlannerUserContentForTest({ userQuery: "blackgaze bands" });
  assert.doesNotMatch(content, /obscurity_target:/i);
});

test("PLANNER_SYSTEM_PROMPT_FOR_TEST instructs model to treat follow-ups as refinements and avoid already-seen bands", () => {
  const { PLANNER_SYSTEM_PROMPT_FOR_TEST } = require("../../src/agent/research/webSearchPlanner");
  assert.match(PLANNER_SYSTEM_PROMPT_FOR_TEST, /follow.up|refinement/i, "should mention follow-up refinement");
  assert.match(PLANNER_SYSTEM_PROMPT_FOR_TEST, /avoid|already/i, "should instruct to avoid already-recommended bands");
});

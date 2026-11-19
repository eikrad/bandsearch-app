import test from "node:test";
import assert from "node:assert/strict";
import { tryParseSearchPlanFromModelText, fallbackSearchPlan, createWebSearchPlanner, buildPlannerUserContentForTest, PLANNER_SYSTEM_PROMPT_FOR_TEST } from "../../src/agent/research/webSearchPlanner.js";

test("tryParseSearchPlanFromModelText reads queries array", () => {
  const raw = '{"anchorArtists":["Grade"],"styleSignals":["hardcore"],"mustHave":[],"avoid":[],"queries":["a","b"]}';
  const plan = tryParseSearchPlanFromModelText(raw);
  assert.ok(plan, "search plan should parse");
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

test("the fallback plan for Cult Following searches Bandcamp last", () => {
  const plan = fallbackSearchPlan("blackgaze", "cult");
  assert.match(plan.queries.at(-1)!, /bandcamp\.com/);
  assert.doesNotMatch(plan.queries[0]!, /bandcamp\.com/);
});

test("createWebSearchPlanner rejects empty apiKey", async () => {
  await assert.rejects(() => createWebSearchPlanner({ apiKey: "  " }), /apiKey is required/);
});

// ─── Phase 8.3: obscurityTarget constraint ─────────────────────────────────

test("the planner is told the target's listener range and that bands below it miss as much as above (#325)", () => {
  const ranges = { cult: "20,000–500,000", underground: "2,000–50,000", obscure: "0–5,000" } as const;
  for (const [target, range] of Object.entries(ranges)) {
    const content = buildPlannerUserContentForTest({ userQuery: "blackgaze bands", obscurityTarget: target });
    assert.ok(content.includes(`obscurity_target (${target})`), `${target}: the constraint is present`);
    assert.ok(content.includes(range), `${target}: the range ${range} is stated`);
    assert.match(content, /below the range is as wrong as one above/i, `${target}: both directions`);
  }
});

test("for Cult Following the planner is steered to scene-level sources rather than Bandcamp", () => {
  const content = buildPlannerUserContentForTest({ userQuery: "blackgaze bands", obscurityTarget: "cult" });
  assert.match(content, /last\.fm\/music\/.*\+similar/);
  assert.match(content, /rateyourmusic/);
  assert.match(content, /bandcamp\.com for at most a quarter/i);
});

/** A planner whose model answers with these queries. */
async function plannerAnswering(queries: string[]) {
  return createWebSearchPlanner({
    apiKey: "",
    modelClient: {
      async invoke() {
        return { content: JSON.stringify({ anchorArtists: [], styleSignals: [], mustHave: [], avoid: [], queries }) };
      },
    },
  });
}

const bandcampFirst = [
  "blackgaze site:bandcamp.com",
  "atmospheric black metal site:bandcamp.com FFO",
  "blackgaze site:rateyourmusic.com",
  "Alcest site:last.fm/music/Alcest/+similar",
  "post-black metal tag site:bandcamp.com",
];

test("for Cult Following the searched-first queries are the non-Bandcamp ones", async () => {
  const plan = await (await plannerAnswering(bandcampFirst))({ userQuery: "blackgaze", obscurityTarget: "cult" });
  assert.deepEqual(plan.queries, [
    "blackgaze site:rateyourmusic.com",
    "Alcest site:last.fm/music/Alcest/+similar",
    "blackgaze site:bandcamp.com",
    "atmospheric black metal site:bandcamp.com FFO",
    "post-black metal tag site:bandcamp.com",
  ]);
});

test("for Underground Bandcamp and other queries alternate, other first", async () => {
  const plan = await (await plannerAnswering(bandcampFirst))({ userQuery: "blackgaze", obscurityTarget: "underground" });
  assert.deepEqual(plan.queries, [
    "blackgaze site:rateyourmusic.com",
    "blackgaze site:bandcamp.com",
    "Alcest site:last.fm/music/Alcest/+similar",
    "atmospheric black metal site:bandcamp.com FFO",
    "post-black metal tag site:bandcamp.com",
  ]);
});

test("for Truly Obscure and without a target the planner's order stands", async () => {
  const planner = await plannerAnswering(bandcampFirst);
  assert.deepEqual((await planner({ userQuery: "blackgaze", obscurityTarget: "obscure" })).queries, bandcampFirst);
  assert.deepEqual((await planner({ userQuery: "blackgaze" })).queries, bandcampFirst);
});

test("buildPlannerUserContent omits obscurity constraint when obscurityTarget is not set", () => {
  const content = buildPlannerUserContentForTest({ userQuery: "blackgaze bands" });
  assert.doesNotMatch(content, /obscurity_target:/i);
});

test("PLANNER_SYSTEM_PROMPT_FOR_TEST instructs model to treat follow-ups as refinements and avoid already-seen bands", () => {
  assert.match(PLANNER_SYSTEM_PROMPT_FOR_TEST, /follow.up|refinement/i, "should mention follow-up refinement");
  assert.match(PLANNER_SYSTEM_PROMPT_FOR_TEST, /avoid|already/i, "should instruct to avoid already-recommended bands");
});

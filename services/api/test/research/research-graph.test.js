const test = require("node:test");
const assert = require("node:assert/strict");

const { shouldRouteToRankAfterVerify, buildResearchGraph } = require("../../src/agent/research/researchGraph");

const deps = {
  targetVerifiedCount: 3,
  totalSearchBudget: 10,
};

test("shouldRouteToRankAfterVerify when verified count reached", () => {
  assert.equal(
    shouldRouteToRankAfterVerify(
      [{ verified: true }, { verified: true }, { verified: true }],
      false,
      2,
      deps,
    ),
    true,
  );
});

test("shouldRouteToRankAfterVerify when reflection already used", () => {
  assert.equal(
    shouldRouteToRankAfterVerify([{ verified: false }], true, 1, deps),
    true,
  );
});

test("shouldRouteToRankAfterVerify when search budget exhausted", () => {
  assert.equal(
    shouldRouteToRankAfterVerify([{ verified: false }], false, 10, deps),
    true,
  );
});

test("shouldRouteToRankAfterVerify false when need reflection", () => {
  assert.equal(
    shouldRouteToRankAfterVerify([{ verified: true }], false, 2, deps),
    false,
  );
});

test("buildResearchGraph compiles", async () => {
  const g = await buildResearchGraph({
    geminiApiKey: "x",
    braveApiKey: "y",
    maxInitialSearches: 2,
    maxReflectionSearches: 2,
    totalSearchBudget: 5,
    targetVerifiedCount: 8,
    researchTimeoutMs: 5000,
  });
  assert.ok(typeof g.invoke === "function");
});

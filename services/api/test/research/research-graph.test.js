const test = require("node:test");
const assert = require("node:assert/strict");

const { buildResearchGraph } = require("../../src/agent/research/researchGraph");
const { createResearchBudget } = require("../../src/agent/research/researchBudget");

test("buildResearchGraph compiles", async () => {
  const budget = createResearchBudget(5000);
  const g = await buildResearchGraph(
    {
      geminiApiKey: "x",
      braveApiKey: "y",
      maxInitialSearches: 2,
      maxReflectionSearches: 2,
      totalSearchBudget: 5,
      targetVerifiedCount: 8,
      researchTimeoutMs: 5000,
    },
    budget,
  );
  assert.ok(typeof g.invoke === "function");
});

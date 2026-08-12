import test from "node:test";
import assert from "node:assert/strict";
import { buildResearchGraph } from "../../src/agent/research/researchGraph.js";
import { createResearchBudget } from "../../src/agent/research/researchBudget.js";

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

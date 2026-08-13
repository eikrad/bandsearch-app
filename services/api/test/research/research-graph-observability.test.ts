import test from "node:test";
import assert from "node:assert/strict";
import { buildResearchGraph } from "../../src/agent/research/researchGraph.js";
import { buildReflectionSubgraph } from "../../src/agent/research/reflectionSubgraph.js";
import { createResearchBudget } from "../../src/agent/research/researchBudget.js";

const BASE_DEPS = {
  geminiApiKey: "x",
  braveApiKey: "y",
  maxInitialSearches: 2,
  maxReflectionSearches: 2,
  totalSearchBudget: 5,
  targetVerifiedCount: 8,
  researchTimeoutMs: 5000,
};

const STUB_MB = {
  async searchArtists() { return []; },
  async lookupArtist() { throw new Error("unexpected lookup"); },
};

const STUB_RUN_QUERIES = async () => ({ hits: [], calls: 0 });

test("parent graph channels include roundsCompleted", async () => {
  const budget = createResearchBudget(5000);
  const g = await buildResearchGraph(BASE_DEPS, budget);
  assert.ok(
    Object.keys(g.channels).includes("roundsCompleted"),
    "roundsCompleted must be a channel in the parent graph state",
  );
});

test("parent graph channels include nextExtraQueries", async () => {
  const budget = createResearchBudget(5000);
  const g = await buildResearchGraph(BASE_DEPS, budget);
  assert.ok(
    Object.keys(g.channels).includes("nextExtraQueries"),
    "nextExtraQueries must be a channel in the parent graph state",
  );
});

test("parent graph channels include newHits", async () => {
  const budget = createResearchBudget(5000);
  const g = await buildResearchGraph(BASE_DEPS, budget);
  assert.ok(
    Object.keys(g.channels).includes("newHits"),
    "newHits must be a channel in the parent graph state",
  );
});

test("all reflection subgraph channels are present in the parent graph", async () => {
  // This is the key invariant for a transparent (non-blackbox) subgraph:
  // every field the subgraph writes must exist as a channel in the parent
  // so LangGraph can route values back up and LangSmith can trace them.
  const budget = createResearchBudget(5000);
  const parentGraph = await buildResearchGraph(BASE_DEPS, budget);
  const subgraph = buildReflectionSubgraph({
    geminiApiKey: "x",
    mb: STUB_MB,
    runQueries: STUB_RUN_QUERIES,
    budget,
    maxRounds: 2,
    maxReflectionSearches: 2,
    targetVerifiedCount: 8,
    totalSearchBudget: 5,
  });

  const parentChannels = new Set(Object.keys(parentGraph.channels));
  const subgraphChannels = Object.keys(subgraph.channels).filter(
    (k) => !k.startsWith("__") && !k.startsWith("branch:"),
  );

  for (const ch of subgraphChannels) {
    assert.ok(
      parentChannels.has(ch),
      `reflection subgraph channel "${ch}" is missing from parent graph — subgraph is a blackbox`,
    );
  }
});

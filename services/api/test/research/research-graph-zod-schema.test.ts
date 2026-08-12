import test from "node:test";
import assert from "node:assert/strict";
import { buildResearchGraph, RESEARCH_SCHEMA } from "../../src/agent/research/researchGraph.js";
import { buildReflectionSubgraph, REFLECTION_SCHEMA } from "../../src/agent/research/reflectionSubgraph.js";
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

// --- Schema export tests ---

test("RESEARCH_SCHEMA is exported from researchGraph", () => {
  assert.ok(RESEARCH_SCHEMA !== undefined, "RESEARCH_SCHEMA must be exported");
});

test("REFLECTION_SCHEMA is exported from reflectionSubgraph", () => {
  assert.ok(REFLECTION_SCHEMA !== undefined, "REFLECTION_SCHEMA must be exported");
});

test("RESEARCH_SCHEMA is a StateSchema (has fields property and getChannelKeys method)", () => {
  assert.ok(
    RESEARCH_SCHEMA !== null &&
    typeof RESEARCH_SCHEMA === "object" &&
    "fields" in RESEARCH_SCHEMA &&
    typeof RESEARCH_SCHEMA.getChannelKeys === "function",
    "RESEARCH_SCHEMA must be a StateSchema instance",
  );
});

test("REFLECTION_SCHEMA is a StateSchema (has fields property and getChannelKeys method)", () => {
  assert.ok(
    REFLECTION_SCHEMA !== null &&
    typeof REFLECTION_SCHEMA === "object" &&
    "fields" in REFLECTION_SCHEMA &&
    typeof REFLECTION_SCHEMA.getChannelKeys === "function",
    "REFLECTION_SCHEMA must be a StateSchema instance",
  );
});

// --- Schema validation tests ---

const VALID_RESEARCH_STATE = {
  userQuery: "bands like Neurosis",
  preferenceContext: "",
  messages: [],
  mode: "discover",
  searchPlan: undefined,
  braveHits: [],
  newHits: [],
  searchCallsUsed: 0,
  extractedCandidates: [],
  verifiedCandidates: [],
  reflectionUsed: false,
  roundsCompleted: 0,
  nextExtraQueries: [],
  recommendations: [],
  assistantReply: "",
};

test("RESEARCH_SCHEMA.validateInput accepts a valid full state object", async () => {
  await assert.doesNotReject(
    async () => RESEARCH_SCHEMA.validateInput(VALID_RESEARCH_STATE),
    "validateInput should not reject for a valid state",
  );
});

test("RESEARCH_SCHEMA.validateInput rejects when userQuery is not a string", async () => {
  await assert.rejects(
    async () => RESEARCH_SCHEMA.validateInput({ ...VALID_RESEARCH_STATE, userQuery: 42 }),
    /userQuery/,
    "validateInput should reject for non-string userQuery",
  );
});

test("RESEARCH_SCHEMA.validateInput rejects when searchCallsUsed is not a number", async () => {
  await assert.rejects(
    async () => RESEARCH_SCHEMA.validateInput({ ...VALID_RESEARCH_STATE, searchCallsUsed: "five" }),
    /searchCallsUsed/,
    "validateInput should reject for non-number searchCallsUsed",
  );
});

test("RESEARCH_SCHEMA.validateInput rejects when reflectionUsed is not a boolean", async () => {
  await assert.rejects(
    async () => RESEARCH_SCHEMA.validateInput({ ...VALID_RESEARCH_STATE, reflectionUsed: "yes" }),
    /reflectionUsed/,
    "validateInput should reject for non-boolean reflectionUsed",
  );
});

const VALID_REFLECTION_STATE = {
  braveHits: [],
  newHits: [],
  verifiedCandidates: [],
  extractedCandidates: [],
  searchCallsUsed: 0,
  searchPlan: undefined,
  userQuery: "bands like Neurosis",
  reflectionUsed: false,
  roundsCompleted: 0,
  nextExtraQueries: [],
};

test("REFLECTION_SCHEMA.validateInput accepts a valid full state object", async () => {
  await assert.doesNotReject(
    async () => REFLECTION_SCHEMA.validateInput(VALID_REFLECTION_STATE),
    "validateInput should not reject for a valid state",
  );
});

test("REFLECTION_SCHEMA.validateInput rejects when userQuery is not a string", async () => {
  await assert.rejects(
    async () => REFLECTION_SCHEMA.validateInput({ ...VALID_REFLECTION_STATE, userQuery: null }),
    /userQuery/,
    "validateInput should reject for null userQuery",
  );
});

// --- Schema shape tests ---

test("RESEARCH_SCHEMA contains all expected field keys", () => {
  const expectedKeys = [
    "userQuery", "preferenceContext", "messages", "mode",
    "searchPlan", "braveHits", "newHits", "searchCallsUsed",
    "extractedCandidates", "verifiedCandidates", "reflectionUsed",
    "roundsCompleted", "nextExtraQueries", "recommendations", "assistantReply",
  ];
  const keys = RESEARCH_SCHEMA.getChannelKeys();
  for (const key of expectedKeys) {
    assert.ok(keys.includes(key), `RESEARCH_SCHEMA is missing field: ${key}`);
  }
});

test("REFLECTION_SCHEMA contains all expected field keys", () => {
  const expectedKeys = [
    "braveHits", "newHits", "verifiedCandidates", "extractedCandidates",
    "searchCallsUsed", "searchPlan", "userQuery", "reflectionUsed",
    "roundsCompleted", "nextExtraQueries",
  ];
  const keys = REFLECTION_SCHEMA.getChannelKeys();
  for (const key of expectedKeys) {
    assert.ok(keys.includes(key), `REFLECTION_SCHEMA is missing field: ${key}`);
  }
});

// --- Graph channel invariants still hold after migration ---

test("parent graph channels still include all required keys after StateSchema migration", async () => {
  const budget = createResearchBudget(5000);
  const g = await buildResearchGraph(BASE_DEPS, budget);
  const required = ["roundsCompleted", "nextExtraQueries", "newHits", "braveHits", "reflectionUsed"];
  for (const key of required) {
    assert.ok(
      Object.keys(g.channels).includes(key),
      `channel "${key}" must be present in compiled graph after StateSchema migration`,
    );
  }
});

test("all reflection subgraph channels still present in parent after StateSchema migration", async () => {
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
      `reflection subgraph channel "${ch}" is missing from parent — subgraph is a blackbox`,
    );
  }
});

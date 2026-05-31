const test = require("node:test");
const assert = require("node:assert/strict");

const { buildResearchGraph, RESEARCH_SCHEMA } = require("../../src/agent/research/researchGraph");
const { buildReflectionSubgraph, REFLECTION_SCHEMA } = require("../../src/agent/research/reflectionSubgraph");
const { createResearchBudget } = require("../../src/agent/research/researchBudget");

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

test("RESEARCH_SCHEMA is a Zod schema (has _def.typeName)", () => {
  assert.ok(
    RESEARCH_SCHEMA !== null &&
    typeof RESEARCH_SCHEMA === "object" &&
    "_def" in RESEARCH_SCHEMA,
    "RESEARCH_SCHEMA must be a Zod schema object with a _def property",
  );
});

test("REFLECTION_SCHEMA is a Zod schema (has _def.typeName)", () => {
  assert.ok(
    REFLECTION_SCHEMA !== null &&
    typeof REFLECTION_SCHEMA === "object" &&
    "_def" in REFLECTION_SCHEMA,
    "REFLECTION_SCHEMA must be a Zod schema object with a _def property",
  );
});

// --- Zod parse tests ---

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

test("RESEARCH_SCHEMA.safeParse accepts a valid full state object", () => {
  const result = RESEARCH_SCHEMA.safeParse(VALID_RESEARCH_STATE);
  assert.ok(result.success, `safeParse should succeed but got: ${JSON.stringify(result.error)}`);
});

test("RESEARCH_SCHEMA.safeParse rejects when userQuery is not a string", () => {
  const result = RESEARCH_SCHEMA.safeParse({ ...VALID_RESEARCH_STATE, userQuery: 42 });
  assert.strictEqual(result.success, false, "safeParse should fail when userQuery is a number");
});

test("RESEARCH_SCHEMA.safeParse rejects when searchCallsUsed is not a number", () => {
  const result = RESEARCH_SCHEMA.safeParse({ ...VALID_RESEARCH_STATE, searchCallsUsed: "five" });
  assert.strictEqual(result.success, false, "safeParse should fail when searchCallsUsed is a string");
});

test("RESEARCH_SCHEMA.safeParse rejects when reflectionUsed is not a boolean", () => {
  const result = RESEARCH_SCHEMA.safeParse({ ...VALID_RESEARCH_STATE, reflectionUsed: "yes" });
  assert.strictEqual(result.success, false, "safeParse should fail when reflectionUsed is a string");
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

test("REFLECTION_SCHEMA.safeParse accepts a valid full state object", () => {
  const result = REFLECTION_SCHEMA.safeParse(VALID_REFLECTION_STATE);
  assert.ok(result.success, `safeParse should succeed but got: ${JSON.stringify(result.error)}`);
});

test("REFLECTION_SCHEMA.safeParse rejects when userQuery is not a string", () => {
  const result = REFLECTION_SCHEMA.safeParse({ ...VALID_REFLECTION_STATE, userQuery: null });
  assert.strictEqual(result.success, false, "safeParse should fail when userQuery is null");
});

// --- Schema shape tests ---

test("RESEARCH_SCHEMA contains all expected field keys", () => {
  const expectedKeys = [
    "userQuery", "preferenceContext", "messages", "mode",
    "searchPlan", "braveHits", "newHits", "searchCallsUsed",
    "extractedCandidates", "verifiedCandidates", "reflectionUsed",
    "roundsCompleted", "nextExtraQueries", "recommendations", "assistantReply",
  ];
  const shape = RESEARCH_SCHEMA.shape ?? RESEARCH_SCHEMA._def?.shape?.();
  assert.ok(shape, "RESEARCH_SCHEMA must expose a shape property");
  for (const key of expectedKeys) {
    assert.ok(key in shape, `RESEARCH_SCHEMA is missing field: ${key}`);
  }
});

test("REFLECTION_SCHEMA contains all expected field keys", () => {
  const expectedKeys = [
    "braveHits", "newHits", "verifiedCandidates", "extractedCandidates",
    "searchCallsUsed", "searchPlan", "userQuery", "reflectionUsed",
    "roundsCompleted", "nextExtraQueries",
  ];
  const shape = REFLECTION_SCHEMA.shape ?? REFLECTION_SCHEMA._def?.shape?.();
  assert.ok(shape, "REFLECTION_SCHEMA must expose a shape property");
  for (const key of expectedKeys) {
    assert.ok(key in shape, `REFLECTION_SCHEMA is missing field: ${key}`);
  }
});

// --- Graph channel invariants still hold after migration ---

test("parent graph channels still include all required keys after Zod migration", async () => {
  const budget = createResearchBudget(5000);
  const g = await buildResearchGraph(BASE_DEPS, budget);
  const required = ["roundsCompleted", "nextExtraQueries", "newHits", "braveHits", "reflectionUsed"];
  for (const key of required) {
    assert.ok(
      Object.keys(g.channels).includes(key),
      `channel "${key}" must be present in compiled graph after Zod migration`,
    );
  }
});

test("all reflection subgraph channels still present in parent after Zod migration", async () => {
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
      `reflection subgraph channel "${ch}" is missing from parent after Zod migration`,
    );
  }
});

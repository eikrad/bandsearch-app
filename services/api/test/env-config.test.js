const test = require("node:test");
const assert = require("node:assert/strict");

const { validateRuntimeEnv } = require("../src/config/env");

const WITH_GEMINI = { GEMINI_API_KEY: "test-gemini-key" };

test("validateRuntimeEnv requires GEMINI_API_KEY", () => {
  assert.throws(() => validateRuntimeEnv({}), /GEMINI_API_KEY is required/);
});

test("validateRuntimeEnv returns defaults for minimal env", () => {
  const config = validateRuntimeEnv({ ...WITH_GEMINI });
  assert.equal(config.geminiApiKey, "test-gemini-key");
  assert.equal(config.lastFmApiKey, "");
  assert.equal(config.braveApiKey, "");
  assert.equal(config.recommendationPipeline, "classic");
  assert.equal(config.researchMaxInitialSearches, 6);
  assert.equal(config.researchMaxReflectionSearches, 4);
  assert.equal(config.researchTotalSearchBudget, 10);
  assert.equal(config.researchTimeoutMs, 25000);
  assert.equal(config.researchTargetVerifiedCandidates, 8);
  assert.equal(config.port, 3001);
  assert.equal(config.recommendationTimeoutMs, 8000);
  assert.equal(config.musicBrainzTimeoutMs, 5000);
  assert.equal(config.musicBrainzRetries, 1);
  assert.equal(config.corsOrigin, "*");
});

test("validateRuntimeEnv parses RECOMMENDATION_PIPELINE research", () => {
  const config = validateRuntimeEnv({ ...WITH_GEMINI, RECOMMENDATION_PIPELINE: "research" });
  assert.equal(config.recommendationPipeline, "research");
});

test("validateRuntimeEnv maps unknown RECOMMENDATION_PIPELINE to classic", () => {
  const config = validateRuntimeEnv({ ...WITH_GEMINI, RECOMMENDATION_PIPELINE: "foo" });
  assert.equal(config.recommendationPipeline, "classic");
});

test("validateRuntimeEnv requires LangSmith API key when tracing enabled", () => {
  assert.throws(
    () => validateRuntimeEnv({ ...WITH_GEMINI, LANGSMITH_TRACING: "true" }),
    /LANGSMITH_API_KEY is required/,
  );
});

test("validateRuntimeEnv requires database URL when postgres store enabled", () => {
  assert.throws(
    () => validateRuntimeEnv({ ...WITH_GEMINI, PREFERENCE_STORE: "postgres" }),
    /DATABASE_URL is required/,
  );
});

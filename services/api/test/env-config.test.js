const test = require("node:test");
const assert = require("node:assert/strict");

const { validateRuntimeEnv } = require("../src/config/env");

const REQUIRED = { GEMINI_API_KEY: "test-gemini-key", BRAVE_API_KEY: "test-brave-key" };

test("validateRuntimeEnv requires GEMINI_API_KEY", () => {
  assert.throws(
    () => validateRuntimeEnv({ BRAVE_API_KEY: "key" }),
    /GEMINI_API_KEY is required/,
  );
});

test("validateRuntimeEnv requires BRAVE_API_KEY", () => {
  assert.throws(
    () => validateRuntimeEnv({ GEMINI_API_KEY: "key" }),
    /BRAVE_API_KEY is required/,
  );
});

test("validateRuntimeEnv returns defaults for minimal env", () => {
  const config = validateRuntimeEnv({ ...REQUIRED });
  assert.equal(config.geminiApiKey, "test-gemini-key");
  assert.equal(config.braveApiKey, "test-brave-key");
  assert.equal(config.lastFmApiKey, "");
  assert.equal(config.researchMaxInitialSearches, 6);
  assert.equal(config.researchMaxReflectionSearches, 4);
  assert.equal(config.researchTotalSearchBudget, 10);
  assert.equal(config.researchTimeoutMs, 25000);
  assert.equal(config.researchTargetVerifiedCandidates, 8);
  assert.equal(config.port, 3001);
  assert.equal(config.musicBrainzTimeoutMs, 5000);
  assert.equal(config.musicBrainzRetries, 1);
  assert.equal(config.corsOrigin, "*");
  // classic-only fields are gone
  assert.equal("recommendationPipeline" in config, false);
  assert.equal("recommendationTimeoutMs" in config, false);
});

test("validateRuntimeEnv pipelineReadyTimeoutMs defaults to 45000", () => {
  const config = validateRuntimeEnv({ ...REQUIRED });
  assert.equal(config.pipelineReadyTimeoutMs, 45000);
});

test("validateRuntimeEnv pipelineReadyTimeoutMs reads custom value", () => {
  const config = validateRuntimeEnv({
    ...REQUIRED,
    RECOMMENDATION_PIPELINE_READY_TIMEOUT_MS: "60000",
  });
  assert.equal(config.pipelineReadyTimeoutMs, 60000);
});

test("validateRuntimeEnv requires LangSmith API key when tracing enabled", () => {
  assert.throws(
    () => validateRuntimeEnv({ ...REQUIRED, LANGSMITH_TRACING: "true" }),
    /LANGSMITH_API_KEY is required/,
  );
});

test("validateRuntimeEnv requires database URL when postgres store enabled", () => {
  assert.throws(
    () => validateRuntimeEnv({ ...REQUIRED, PREFERENCE_STORE: "postgres" }),
    /DATABASE_URL is required/,
  );
});

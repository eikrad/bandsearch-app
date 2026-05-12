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
  assert.equal(config.port, 3001);
  assert.equal(config.recommendationTimeoutMs, 8000);
  assert.equal(config.musicBrainzTimeoutMs, 5000);
  assert.equal(config.musicBrainzRetries, 1);
  assert.equal(config.corsOrigin, "*");
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

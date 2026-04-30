const test = require("node:test");
const assert = require("node:assert/strict");

const { validateRuntimeEnv } = require("../src/config/env");

test("validateRuntimeEnv returns defaults for empty env", () => {
  const config = validateRuntimeEnv({});
  assert.equal(config.port, 3001);
  assert.equal(config.recommendationTimeoutMs, 8000);
  assert.equal(config.musicBrainzTimeoutMs, 5000);
  assert.equal(config.musicBrainzRetries, 1);
  assert.equal(config.corsOrigin, "*");
});

test("validateRuntimeEnv requires LangSmith API key when tracing enabled", () => {
  assert.throws(
    () => validateRuntimeEnv({ LANGSMITH_TRACING: "true" }),
    /LANGSMITH_API_KEY is required/,
  );
});

test("validateRuntimeEnv requires database URL when postgres store enabled", () => {
  assert.throws(
    () => validateRuntimeEnv({ PREFERENCE_STORE: "postgres" }),
    /DATABASE_URL is required/,
  );
});

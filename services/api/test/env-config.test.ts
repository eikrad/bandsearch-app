import { test } from "node:test";
import assert from "node:assert/strict";

import { validateRuntimeEnv } from "../src/config/env.js";

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
    /BRAVE_API_KEY .*is required/,
  );
});

test("validateRuntimeEnv accepts BRAVE_SEARCH_API_KEY as an alias", () => {
  const config = validateRuntimeEnv({ GEMINI_API_KEY: "key", BRAVE_SEARCH_API_KEY: "alias-brave-key" });
  assert.equal(config.braveApiKey, "alias-brave-key");
});

test("validateRuntimeEnv returns defaults for minimal env", () => {
  const config = validateRuntimeEnv({ ...REQUIRED });
  assert.equal(config.geminiApiKey, "test-gemini-key");
  assert.equal(config.braveApiKey, "test-brave-key");
  assert.equal(config.lastFmApiKey, "");
  assert.equal(config.researchMaxInitialSearches, 6);
  assert.equal(config.researchMaxReflectionSearches, 4);
  assert.equal(config.researchTotalSearchBudget, 10);
  assert.equal(config.researchTimeoutMs, 45000);
  assert.equal(config.researchTargetVerifiedCandidates, 8);
  assert.equal(config.port, 3001);
  assert.equal(config.musicBrainzTimeoutMs, 5000);
  assert.equal(config.musicBrainzRetries, 1);
  assert.equal(config.corsOrigin, "*");
  assert.equal(config.evalDashboardEnabled, false);
  // classic-only fields are gone
  assert.equal("recommendationPipeline" in config, false);
  assert.equal("recommendationTimeoutMs" in config, false);
});

test("validateRuntimeEnv enables eval dashboard when EVAL_DASHBOARD_ENABLED=true", () => {
  const config = validateRuntimeEnv({ ...REQUIRED, EVAL_DASHBOARD_ENABLED: "true" });
  assert.equal(config.evalDashboardEnabled, true);
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

// The Postgres adapter was removed. An existing deployment may still carry
// PREFERENCE_STORE=postgres, and silently serving it SQLite would swap its
// database without a word, so boot has to stop instead.
test("validateRuntimeEnv rejects the removed postgres store instead of falling back", () => {
  assert.throws(
    () => validateRuntimeEnv({ ...REQUIRED, PREFERENCE_STORE: "postgres" }),
    /PREFERENCE_STORE=postgres is no longer supported/,
  );
});

test("validateRuntimeEnv uses provided JWT_SECRET", () => {
  const config = validateRuntimeEnv({ ...REQUIRED, JWT_SECRET: "my-secret-key" });
  assert.equal(config.jwtSecret, "my-secret-key");
});

test("validateRuntimeEnv auto-generates jwtSecret when JWT_SECRET is absent", () => {
  const config = validateRuntimeEnv({ ...REQUIRED });
  assert.equal(typeof config.jwtSecret, "string");
  assert.ok(config.jwtSecret.length >= 32);
});

test("validateRuntimeEnv auto-generates a different jwtSecret each call when absent", () => {
  const a = validateRuntimeEnv({ ...REQUIRED });
  const b = validateRuntimeEnv({ ...REQUIRED });
  assert.notEqual(a.jwtSecret, b.jwtSecret);
});

// turso-sync is a separate store value rather than a flag on `turso`, so an
// existing PREFERENCE_STORE=turso deployment keeps talking to the cloud
// directly and nothing changes under it by accident.
test("validateRuntimeEnv accepts the turso-sync store", () => {
  const config = validateRuntimeEnv({
    ...REQUIRED,
    PREFERENCE_STORE: "turso-sync",
    TURSO_DATABASE_URL: "libsql://example.turso.io",
  });
  assert.equal(config.preferenceStore, "turso-sync");
  assert.equal(config.tursoSyncPath, "bandsearch-sync.db");
});

test("validateRuntimeEnv lets TURSO_SYNC_PATH override the replica location", () => {
  const config = validateRuntimeEnv({
    ...REQUIRED,
    PREFERENCE_STORE: "turso-sync",
    TURSO_DATABASE_URL: "libsql://example.turso.io",
    TURSO_SYNC_PATH: "/var/data/replica.db",
  });
  assert.equal(config.tursoSyncPath, "/var/data/replica.db");
});

test("validateRuntimeEnv requires a remote URL for turso-sync", () => {
  assert.throws(
    () => validateRuntimeEnv({ ...REQUIRED, PREFERENCE_STORE: "turso-sync" }),
    /TURSO_DATABASE_URL is required/,
  );
});

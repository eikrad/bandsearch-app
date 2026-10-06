import { test } from "node:test";
import assert from "node:assert/strict";

import { validateRuntimeEnv } from "../src/config/env.js";

const REQUIRED = { SCW_SECRET_KEY: "test-scw-key", BRAVE_API_KEY: "test-brave-key" };
/** Gemini, the provider before the Scaleway switch (#237); kept selectable for rollback. */
const GEMINI = { LLM_PROVIDER: "gemini", GEMINI_API_KEY: "test-gemini-key", BRAVE_API_KEY: "test-brave-key" };

test("validateRuntimeEnv requires SCW_SECRET_KEY: Scaleway is the default provider", () => {
  assert.throws(() => validateRuntimeEnv({ BRAVE_API_KEY: "key" }), /SCW_SECRET_KEY is required/);
});

test("validateRuntimeEnv requires GEMINI_API_KEY when LLM_PROVIDER=gemini", () => {
  assert.throws(() => validateRuntimeEnv({ LLM_PROVIDER: "gemini", BRAVE_API_KEY: "key" }), /GEMINI_API_KEY is required/);
});

test("validateRuntimeEnv requires BRAVE_API_KEY", () => {
  assert.throws(
    () => validateRuntimeEnv({ SCW_SECRET_KEY: "key" }),
    /BRAVE_API_KEY .*is required/,
  );
});

test("validateRuntimeEnv accepts BRAVE_SEARCH_API_KEY as an alias", () => {
  const config = validateRuntimeEnv({ SCW_SECRET_KEY: "key", BRAVE_SEARCH_API_KEY: "alias-brave-key" });
  assert.equal(config.braveApiKey, "alias-brave-key");
});

test("validateRuntimeEnv returns defaults for minimal env", () => {
  const config = validateRuntimeEnv({ ...REQUIRED });
  assert.equal(config.llm.scalewayApiKey, "test-scw-key");
  assert.equal(config.geminiApiKey, "");
  assert.equal(config.braveApiKey, "test-brave-key");
  assert.equal(config.lastFmApiKey, "");
  assert.equal(config.researchMaxInitialSearches, 6);
  assert.equal(config.researchMaxReflectionSearches, 4);
  assert.equal(config.researchTotalSearchBudget, 10);
  assert.equal(config.researchTimeoutMs, 180000);
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

test("validateRuntimeEnv defaults the Gemini research model to gemini-2.5-flash", () => {
  const config = validateRuntimeEnv({ ...GEMINI });
  assert.equal(config.researchModel, "gemini-2.5-flash");
});

test("validateRuntimeEnv lets GEMINI_MODEL choose the research model", () => {
  const config = validateRuntimeEnv({ ...GEMINI, GEMINI_MODEL: " gemini-2.5-pro " });
  assert.equal(config.researchModel, "gemini-2.5-pro");
});

// ─── LLM roles (#237) ─────────────────────────────────────────────────────────

const BRAVE = { BRAVE_API_KEY: "test-brave-key" };

test("the research graph runs on Scaleway unless LLM_PROVIDER says otherwise", () => {
  const { llm } = validateRuntimeEnv({ ...REQUIRED });
  assert.deepEqual(llm.research, { provider: "scaleway", model: "deepseek-v4-flash-0731", reasoningEffort: "none" });
});

test("LLM_PROVIDER=gemini still runs the research graph on Gemini, the rollback path", () => {
  const { llm } = validateRuntimeEnv({ ...GEMINI });
  assert.deepEqual(llm.research, { provider: "gemini", model: "gemini-2.5-flash" });
});

test("LLM_PROVIDER=scaleway runs the research graph on Scaleway without a Gemini key", () => {
  const { llm, researchModel } = validateRuntimeEnv({ ...BRAVE, LLM_PROVIDER: "scaleway", SCW_SECRET_KEY: "scw" });
  assert.equal(llm.research.provider, "scaleway");
  assert.equal(llm.research.model, "deepseek-v4-flash-0731");
  assert.equal(researchModel, "deepseek-v4-flash-0731", "provenance names the Scaleway model");
});

test("SCW_MODEL chooses the Scaleway research model", () => {
  const { llm } = validateRuntimeEnv({
    ...BRAVE,
    LLM_PROVIDER: "scaleway",
    SCW_SECRET_KEY: "scw",
    SCW_MODEL: " qwen3.6-35b-a3b ",
  });
  assert.equal(llm.research.model, "qwen3.6-35b-a3b");
});

test("LLM_PROVIDER=scaleway requires SCW_SECRET_KEY", () => {
  assert.throws(() => validateRuntimeEnv({ ...BRAVE, LLM_PROVIDER: "scaleway" }), /SCW_SECRET_KEY is required/);
});

test("an unknown LLM_PROVIDER is rejected, not silently replaced", () => {
  assert.throws(() => validateRuntimeEnv({ ...REQUIRED, LLM_PROVIDER: "mistral" }), /LLM_PROVIDER must be one of scaleway, gemini/);
});

test("the judge runs on Scaleway whenever a Scaleway key is set", () => {
  const { llm } = validateRuntimeEnv({ ...REQUIRED, SCW_SECRET_KEY: "scw" });
  assert.deepEqual(llm.judge, { provider: "scaleway", model: "glm-5.2", reasoningEffort: "none" });
});

test("SCW_JUDGE_MODEL chooses the judge model", () => {
  const { llm } = validateRuntimeEnv({ ...REQUIRED, SCW_SECRET_KEY: "scw", SCW_JUDGE_MODEL: "gpt-oss-120b" });
  assert.equal(llm.judge?.model, "gpt-oss-120b");
});

test("without a Scaleway key there is no judge; a Mistral key no longer enables one", () => {
  const { llm } = validateRuntimeEnv({ ...GEMINI, MISTRAL_API_KEY: "mistral" });
  assert.equal(llm.judge, null);
});

test("a judge that is the research model itself is refused", () => {
  assert.throws(
    () =>
      validateRuntimeEnv({
        ...BRAVE,
        LLM_PROVIDER: "scaleway",
        SCW_SECRET_KEY: "scw",
        SCW_MODEL: "gpt-oss-120b",
        SCW_JUDGE_MODEL: "gpt-oss-120b",
      }),
    /judge .* must not be the research model/,
  );
});

test("a judge from the research model's family is allowed with a warning", () => {
  const { llm } = validateRuntimeEnv({ ...GEMINI, SCW_SECRET_KEY: "scw", SCW_JUDGE_MODEL: "gemma-4-26b-a4b-it" });
  assert.equal(llm.judge?.model, "gemma-4-26b-a4b-it");
  assert.ok(
    llm.warnings.some((w) => /same model family \(google\)/.test(w)),
    `expected a family warning, got ${JSON.stringify(llm.warnings)}`,
  );
});

test("reasoning is off for both roles unless configured per role", () => {
  const { llm } = validateRuntimeEnv({
    ...BRAVE,
    LLM_PROVIDER: "scaleway",
    SCW_SECRET_KEY: "scw",
    SCW_JUDGE_MODEL: "gpt-oss-120b",
    SCW_JUDGE_REASONING_EFFORT: "low",
  });
  assert.equal(llm.research.reasoningEffort, "none");
  assert.equal(llm.judge?.reasoningEffort, "low");
});

test("EVAL_REPLAY_DIR turns on replay of external answers for eval runs", () => {
  assert.equal(validateRuntimeEnv({ ...REQUIRED }).evalReplayDir, "");
  assert.equal(validateRuntimeEnv({ ...REQUIRED, EVAL_REPLAY_DIR: " /tmp/replay " }).evalReplayDir, "/tmp/replay");
});

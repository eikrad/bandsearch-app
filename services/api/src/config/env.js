function parseNumber(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }
  return value === "true";
}

function validateRuntimeEnv(env = process.env) {
  const geminiApiKey = String(env.GEMINI_API_KEY ?? "").trim();
  if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY is required");
  }

  const port = parseNumber(env.PORT, 3001);
  const musicBrainzTimeoutMs = parseNumber(env.MUSICBRAINZ_TIMEOUT_MS, 5000);
  const musicBrainzRetries = parseNumber(env.MUSICBRAINZ_RETRIES, 1);

  const langsmithTracing = normalizeBoolean(env.LANGSMITH_TRACING, false);
  if (langsmithTracing && !env.LANGSMITH_API_KEY) {
    throw new Error("LANGSMITH_API_KEY is required when LANGSMITH_TRACING=true");
  }

  const preferenceStore =
    env.PREFERENCE_STORE === "postgres"
      ? "postgres"
      : env.PREFERENCE_STORE === "turso"
        ? "turso"
        : env.PREFERENCE_STORE === "memory"
          ? "memory"
          : "sqlite";

  const databaseSsl = normalizeBoolean(env.DATABASE_SSL, true);
  const databaseUrl = env.DATABASE_URL || "";
  const databasePath = env.DATABASE_PATH || "bandsearch.db";
  const tursoDatabaseUrl = env.TURSO_DATABASE_URL || "";
  const tursoAuthToken = env.TURSO_AUTH_TOKEN || "";

  if (preferenceStore === "postgres" && !databaseUrl) {
    throw new Error("DATABASE_URL is required when PREFERENCE_STORE=postgres");
  }
  if (preferenceStore === "turso" && !tursoDatabaseUrl) {
    throw new Error("TURSO_DATABASE_URL is required when PREFERENCE_STORE=turso");
  }

  const braveApiKey = String(env.BRAVE_API_KEY ?? "").trim();
  if (!braveApiKey) {
    throw new Error("BRAVE_API_KEY is required");
  }

  const pipelineReadyTimeoutMs = parseNumber(env.RECOMMENDATION_PIPELINE_READY_TIMEOUT_MS, 45000);

  const researchMaxInitialSearches = parseNumber(env.RESEARCH_MAX_INITIAL_SEARCHES, 6);
  const researchMaxReflectionSearches = parseNumber(env.RESEARCH_MAX_REFLECTION_SEARCHES, 4);
  const researchTotalSearchBudget = parseNumber(env.RESEARCH_TOTAL_SEARCH_BUDGET, 10);
  const researchTimeoutMs = parseNumber(env.RESEARCH_TIMEOUT_MS, 25000);
  const researchTargetVerifiedCandidates = parseNumber(env.RESEARCH_TARGET_VERIFIED_CANDIDATES, 8);

  return {
    geminiApiKey,
    lastFmApiKey: String(env.LASTFM_API_KEY ?? "").trim(),
    braveApiKey,
    pipelineReadyTimeoutMs,
    researchMaxInitialSearches,
    researchMaxReflectionSearches,
    researchTotalSearchBudget,
    researchTimeoutMs,
    researchTargetVerifiedCandidates,
    port,
    musicBrainzTimeoutMs,
    musicBrainzRetries,
    corsOrigin: env.CORS_ORIGIN || "*",
    preferenceStore,
    databaseUrl,
    databaseSsl,
    databasePath,
    tursoDatabaseUrl,
    tursoAuthToken,
  };
}

module.exports = {
  validateRuntimeEnv,
};

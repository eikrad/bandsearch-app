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
  const port = parseNumber(env.PORT, 3001);
  const recommendationTimeoutMs = parseNumber(env.RECOMMENDATION_TIMEOUT_MS, 8000);
  const musicBrainzTimeoutMs = parseNumber(env.MUSICBRAINZ_TIMEOUT_MS, 5000);
  const musicBrainzRetries = parseNumber(env.MUSICBRAINZ_RETRIES, 1);

  const langsmithTracing = normalizeBoolean(env.LANGSMITH_TRACING, false);
  if (langsmithTracing && !env.LANGSMITH_API_KEY) {
    throw new Error("LANGSMITH_API_KEY is required when LANGSMITH_TRACING=true");
  }

  const preferenceStore = env.PREFERENCE_STORE === "postgres" ? "postgres" : "memory";
  const databaseSsl = normalizeBoolean(env.DATABASE_SSL, true);
  const databaseUrl = env.DATABASE_URL || "";
  if (preferenceStore === "postgres" && !databaseUrl) {
    throw new Error("DATABASE_URL is required when PREFERENCE_STORE=postgres");
  }

  return {
    port,
    recommendationTimeoutMs,
    musicBrainzTimeoutMs,
    musicBrainzRetries,
    corsOrigin: env.CORS_ORIGIN || "*",
    preferenceStore,
    databaseUrl,
    databaseSsl,
  };
}

module.exports = {
  validateRuntimeEnv,
};

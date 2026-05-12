const { createRecommendationAgent, createLangChainRunner } = require("./agent/recommendationAgent");
const { createMusicBrainzClient } = require("./integrations/musicbrainz");
const {
  createRecommendationError,
  createRecommendationService,
  resolveRecommendationFacadeInput,
} = require("./recommendations");

/**
 * @param {{ runtimeConfig?: any, preferenceRepository?: any, retryDelayMs?: number, logger?: any }} [options]
 */
function createRecommendationPipeline({
  runtimeConfig,
  preferenceRepository,
  retryDelayMs = 5000,
  logger = console,
} = {}) {
  if (
    !preferenceRepository
    || typeof preferenceRepository.buildContext !== "function"
    || typeof preferenceRepository.buildContextForIds !== "function"
  ) {
    throw createRecommendationError(
      "recommendation_configuration_error",
      "preferenceRepository.buildContext and buildContextForIds are required",
    );
  }

  let resolveFirstReady;
  const whenReadyPromise = new Promise((resolve) => {
    resolveFirstReady = resolve;
  });

  let activeService = null;
  let activeError = createRecommendationError(
    "recommendation_initializing",
    "recommendation pipeline is initializing",
  );
  let retryTimer = null;

  function log(level, message, details = {}) {
    const payload = { level, message, ...details };
    const emit = level === "error" ? logger.error : level === "warn" ? logger.warn : logger.log;
    emit(JSON.stringify(payload));
  }

  async function initialize() {
    try {
      const runModel = await createLangChainRunner({
        timeoutMs: runtimeConfig.recommendationTimeoutMs,
        apiKey: runtimeConfig.geminiApiKey,
      });
      activeService = createRecommendationService({
        musicBrainzClient: createMusicBrainzClient({
          timeoutMs: runtimeConfig.musicBrainzTimeoutMs,
          retries: runtimeConfig.musicBrainzRetries,
        }),
        recommendationAgent: createRecommendationAgent({ runModel }),
      });
      activeError = null;
      if (resolveFirstReady) {
        resolveFirstReady();
        resolveFirstReady = undefined;
      }
      log("info", "recommendation pipeline ready");
    } catch (error) {
      activeService = null;
      activeError = createRecommendationError(
        "recommendation_unavailable",
        "recommendation pipeline unavailable",
        error,
      );
      log("warn", "recommendation pipeline init failed; scheduling retry", {
        error: error?.message || "unknown error",
        retryDelayMs,
      });
      scheduleRetry();
    }
  }

  function scheduleRetry() {
    if (retryTimer) {
      return;
    }
    retryTimer = setTimeout(async () => {
      retryTimer = null;
      await initialize();
    }, retryDelayMs);
  }

  void initialize();

  return {
    whenReady: () => whenReadyPromise,
    async recommend(request = {}) {
      if (!activeService) {
        throw activeError
          || createRecommendationError("recommendation_unavailable", "recommendation pipeline unavailable");
      }

      const { mode, preferenceContext, messages } = await resolveRecommendationFacadeInput(
        request,
        preferenceRepository,
      );

      const recommendations = await activeService.getRecommendations(request.query, {
        mode,
        preferenceContext,
        messages,
      });

      return {
        recommendations,
        meta: {
          modeUsed: mode,
          usedPreferenceContext: preferenceContext.length > 0,
        },
      };
    },
  };
}

module.exports = {
  createRecommendationPipeline,
};

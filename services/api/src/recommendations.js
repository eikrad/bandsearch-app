const { validateRecommendationMode } = require("../../../shared/schemas/src/contracts");

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Shared façade step: normalize mode, merge priority text with repository preference context when
 * preference-aware, and collect messages. Used by the lazy-init pipeline and the app fallback stack.
 *
 * @param {Record<string, unknown>} [request]
 * @param {{ buildContext: () => Promise<string>, buildContextForIds?: (ids: string[]) => Promise<string> }} preferenceRepository
 */
async function resolveRecommendationFacadeInput(request = {}, preferenceRepository) {
  const mode = validateRecommendationMode(request.mode);
  const selectedArtistIds = Array.isArray(request.selectedArtistIds)
    ? request.selectedArtistIds.filter((id) => typeof id === "string")
    : [];
  const priorityContext = typeof request.priorityContext === "string" ? request.priorityContext.trim() : "";

  let preferenceContext = priorityContext;
  if (mode === "preference-aware") {
    let repoContext;
    if (selectedArtistIds.length > 0 && typeof preferenceRepository.buildContextForIds === "function") {
      repoContext = await preferenceRepository.buildContextForIds(selectedArtistIds);
    } else {
      repoContext = await preferenceRepository.buildContext();
    }
    preferenceContext = [preferenceContext, repoContext].filter(Boolean).join("\n");
  }

  const messages = Array.isArray(request.messages) ? request.messages : [];

  return { mode, preferenceContext, messages };
}

function validateRecommendationRequest(body) {
  if (!body || !isNonEmptyString(body.query)) {
    return { ok: false, error: "query is required" };
  }
  return { ok: true, query: body.query.trim() };
}

function createRecommendationError(code, message, cause) {
  const error = /** @type {any} */ (new Error(message));
  error.code = code;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

/**
 * @param {{ musicBrainzClient?: any, recommendationAgent?: any }} [deps]
 */
function createRecommendationService({ musicBrainzClient, recommendationAgent } = {}) {
  if (!musicBrainzClient || typeof musicBrainzClient.searchArtists !== "function") {
    throw createRecommendationError(
      "recommendation_configuration_error",
      "musicBrainzClient.searchArtists is required",
    );
  }
  if (!recommendationAgent || typeof recommendationAgent.recommend !== "function") {
    throw createRecommendationError(
      "recommendation_configuration_error",
      "recommendationAgent.recommend is required",
    );
  }

  return {
    async getRecommendations(query, options = {}) {
      const mode = options.mode === "preference-aware" ? "preference-aware" : "fresh";
      const preferenceContext = mode === "preference-aware" ? options.preferenceContext || "" : "";

      let artists;
      try {
        artists = await musicBrainzClient.searchArtists(query);
      } catch (error) {
        throw createRecommendationError(
          "recommendation_context_unavailable",
          "recommendation context unavailable",
          error,
        );
      }

      try {
        const messages = Array.isArray(options.messages) ? options.messages : [];
        return await recommendationAgent.recommend({ query, artists, mode, preferenceContext, messages });
      } catch (error) {
        throw createRecommendationError("recommendation_unavailable", "recommendation unavailable", error);
      }
    },
  };
}

module.exports = {
  validateRecommendationRequest,
  createRecommendationError,
  createRecommendationService,
  resolveRecommendationFacadeInput,
};

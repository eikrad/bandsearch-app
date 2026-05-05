function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateRecommendationRequest(body) {
  if (!body || !isNonEmptyString(body.query)) {
    return { ok: false, error: "query is required" };
  }
  return { ok: true, query: body.query.trim() };
}

function createRecommendationError(code, message, cause) {
  const error = new Error(message);
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

<<<<<<< HEAD
      if (recommendationAgent) {
        try {
          const messages = Array.isArray(options.messages) ? options.messages : [];
          return await recommendationAgent.recommend({ query, artists, mode, preferenceContext, messages });
        } catch {
          // Fallback to deterministic response when model output is unavailable/invalid.
        }
=======
      try {
        return await recommendationAgent.recommend({ query, artists, mode, preferenceContext });
      } catch (error) {
        throw createRecommendationError("recommendation_unavailable", "recommendation unavailable", error);
>>>>>>> b581991 (refactor: centralize recommendation pipeline and scaffold agent skill docs)
      }
    },
  };
}

module.exports = {
  validateRecommendationRequest,
  createRecommendationError,
  createRecommendationService,
};

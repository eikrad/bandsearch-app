const {
  validateRecommendationMode,
  validateRecommendationHttpBody,
} = require("../../../shared/schemas/src/contracts");

/**
 * Match MusicBrainz search hits to recommendation card titles (case-insensitive).
 *
 * @param {unknown[]} items
 * @param {{ id: string, name: string }[]} artists
 */
function enrichRecommendationsWithMbIds(items, artists) {
  if (!Array.isArray(items) || !Array.isArray(artists)) return items;
  return items.map((item) => {
    if (!item || typeof item !== "object") return item;
    const artistName = String(/** @type {any} */ (item).artist || "").trim().toLowerCase();
    const match = artists.find((a) => String(a.name || "").trim().toLowerCase() === artistName);
    if (match?.id) {
      return { ...item, musicbrainzArtistId: match.id };
    }
    return item;
  });
}

/**
 * Shared façade step: normalize mode, merge priority text with repository preference context when
 * preference-aware, and collect messages. Used by the lazy-init pipeline and the app fallback stack.
 *
 * @param {Record<string, unknown>|undefined} request
 * @param {{ buildContext: () => Promise<string>, buildContextForIds: (ids: string[]) => Promise<string> }} preferenceRepository
 */
async function resolveRecommendationFacadeInput(request, preferenceRepository) {
  const req = request ?? {};
  const mode = validateRecommendationMode(req.mode);
  const selectedArtistIds = Array.isArray(req.selectedArtistIds)
    ? req.selectedArtistIds.filter((id) => typeof id === "string")
    : [];
  const priorityContext = typeof req.priorityContext === "string" ? req.priorityContext.trim() : "";

  let preferenceContext = priorityContext;
  if (mode === "preference-aware") {
    let repoContext;
    if (selectedArtistIds.length > 0) {
      repoContext = await preferenceRepository.buildContextForIds(selectedArtistIds);
    } else {
      repoContext = await preferenceRepository.buildContext();
    }
    preferenceContext = [preferenceContext, repoContext].filter(Boolean).join("\n");
  }

  const messages = Array.isArray(req.messages) ? req.messages : [];

  return { mode, preferenceContext, messages };
}

function validateRecommendationRequest(body) {
  return validateRecommendationHttpBody(body);
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
      const mode = validateRecommendationMode(options.mode);
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
        const { recommendations: rawItems, assistantReply } = await recommendationAgent.recommend({
          query,
          artists,
          mode,
          preferenceContext,
          messages,
        });
        const recommendations = enrichRecommendationsWithMbIds(rawItems, artists);
        return { recommendations, assistantReply: typeof assistantReply === "string" ? assistantReply : "" };
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
  enrichRecommendationsWithMbIds,
};

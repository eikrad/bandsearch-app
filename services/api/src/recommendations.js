function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateRecommendationRequest(body) {
  if (!body || !isNonEmptyString(body.query)) {
    return { ok: false, error: "query is required" };
  }
  return { ok: true, query: body.query.trim() };
}

function buildDeterministicFallbackRecommendations(query) {
  const normalized = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const tokens = normalized
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .slice(0, 3);
  const seed = tokens.length > 0 ? tokens : ["niche", "atmospheric", "indie"];

  return seed.map((token, index) => ({
    artist: `Related Artist ${index + 1} (${token})`,
    why: `Deterministic fallback based on your query focus: "${token}".`,
    sourceSignals: ["deterministic_fallback"],
  }));
}

/**
 * @param {{ musicBrainzClient?: any, recommendationAgent?: any }} [deps]
 */
function createRecommendationService({ musicBrainzClient, recommendationAgent } = {}) {
  return {
    async getRecommendations(query, options = {}) {
      const mode = options.mode === "preference-aware" ? "preference-aware" : "fresh";
      const preferenceContext = mode === "preference-aware" ? options.preferenceContext || "" : "";
      let artists = [];
      try {
        artists = await musicBrainzClient.searchArtists(query);
      } catch {
        artists = [];
      }

      if (recommendationAgent) {
        try {
          return await recommendationAgent.recommend({ query, artists, mode, preferenceContext });
        } catch {
          // Fallback to deterministic response when model output is unavailable/invalid.
        }
      }

      if (artists.length === 0) {
        return buildDeterministicFallbackRecommendations(query);
      }

      return artists.slice(0, 3).map((artist) => ({
        artist: artist.name,
        why: `Related match from MusicBrainz search context for "${query}".`,
        sourceSignals: ["musicbrainz_search"],
      }));
    },
  };
}

module.exports = {
  validateRecommendationRequest,
  buildDeterministicFallbackRecommendations,
  createRecommendationService,
};

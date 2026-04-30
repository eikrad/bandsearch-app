function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateRecommendationRequest(body) {
  if (!body || !isNonEmptyString(body.query)) {
    return { ok: false, error: "query is required" };
  }
  return { ok: true, query: body.query.trim() };
}

function buildPlaceholderRecommendations(query) {
  return [
    {
      artist: "Les Discrets",
      why: `Shared atmospheric and melancholic textures related to "${query}".`,
      sourceSignals: ["placeholder_seed"],
    },
    {
      artist: "Sylvaine",
      why: `Strong overlap in dreamlike blackgaze influences connected to "${query}".`,
      sourceSignals: ["placeholder_seed"],
    },
    {
      artist: "Fen",
      why: `Balances post-metal and black metal moods similar to "${query}".`,
      sourceSignals: ["placeholder_seed"],
    },
  ];
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
        return buildPlaceholderRecommendations(query);
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
  buildPlaceholderRecommendations,
  createRecommendationService,
};

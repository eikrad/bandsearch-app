const { sendError } = require("./errors");

/**
 * Canonical artist search: non-empty trimmed query string → MusicBrainz JSON `{ artists }`.
 * Used by GET /artists/search?query= and legacy GET /search/artists?q=
 *
 * @param {{ searchArtists: (q: string) => Promise<unknown[]> }} musicBrainzClient
 */
async function handleArtistSearch(res, rawQuery, musicBrainzClient) {
  const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
  if (!query) {
    return sendError(res, 400, "validation_error", "search query is required");
  }
  try {
    const artists = await musicBrainzClient.searchArtists(query);
    return res.status(200).json({ artists });
  } catch {
    return sendError(res, 502, "search_unavailable", "artist search unavailable");
  }
}

module.exports = {
  handleArtistSearch,
};

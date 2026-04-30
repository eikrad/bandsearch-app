const DEFAULT_BASE_URL = "https://musicbrainz.org/ws/2";
const USER_AGENT = "bandsearch-app/0.1.0 (https://github.com/eikrad/bandsearch-app)";

function createMusicBrainzClient({ fetchImpl = fetch, baseUrl = DEFAULT_BASE_URL } = {}) {
  return {
    async searchArtists(query) {
      const encodedQuery = encodeURIComponent(query);
      const url = `${baseUrl}/artist?query=${encodedQuery}&fmt=json&limit=5`;
      const response = await fetchImpl(url, {
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`musicbrainz request failed with status ${response.status}`);
      }

      const data = await response.json();
      const artists = Array.isArray(data.artists) ? data.artists : [];
      return artists.map((artist) => ({
        id: artist.id,
        name: artist.name,
        score: artist.score,
        disambiguation: artist.disambiguation || "",
      }));
    },
  };
}

module.exports = { createMusicBrainzClient };

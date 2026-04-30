const DEFAULT_BASE_URL = "https://musicbrainz.org/ws/2";
const USER_AGENT = "bandsearch-app/0.1.0 (https://github.com/eikrad/bandsearch-app)";

async function fetchWithTimeoutAndRetry({
  fetchImpl,
  url,
  timeoutMs,
  retries,
  headers,
}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
    }
  }
  throw lastError;
}

function createMusicBrainzClient({
  fetchImpl = fetch,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 5000,
  retries = 1,
} = {}) {
  return {
    async searchArtists(query) {
      const encodedQuery = encodeURIComponent(query);
      const url = `${baseUrl}/artist?query=${encodedQuery}&fmt=json&limit=5`;
      const response = await fetchWithTimeoutAndRetry({
        fetchImpl,
        url,
        timeoutMs,
        retries,
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`musicbrainz request failed with status ${response.status}`);
      }

      /** @type {{ artists?: Array<{ id: string, name: string, score: number, disambiguation?: string }> }} */
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

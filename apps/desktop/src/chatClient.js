function createChatClient({ apiBaseUrl, fetchImpl = fetch }) {
  const baseUrl = apiBaseUrl.endsWith("/") ? apiBaseUrl.slice(0, -1) : apiBaseUrl;

  return {
    async fetchRecommendations(query, mode = "fresh") {
      const response = await fetchImpl(`${baseUrl}/recommendations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, mode }),
      });

      if (!response.ok) {
        throw new Error(`recommendations request failed with status ${response.status}`);
      }

      return response.json();
    },
    async createPreference(savedBand) {
      const response = await fetchImpl(`${baseUrl}/preferences`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(savedBand),
      });
      if (!response.ok) {
        throw new Error(`preference create request failed with status ${response.status}`);
      }
      return response.json();
    },
    async updatePreference(id, updates) {
      const response = await fetchImpl(`${baseUrl}/preferences/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!response.ok) {
        throw new Error(`preference update request failed with status ${response.status}`);
      }
      return response.json();
    },
  };
}

function createInitialChatState() {
  return {
    messages: [],
  };
}

function applyAssistantMessage(state, recommendationResponse) {
  const nextMessage = {
    role: "assistant",
    recommendations: recommendationResponse.recommendations,
    meta: recommendationResponse.meta,
  };

  return {
    ...state,
    messages: [...state.messages, nextMessage],
  };
}

function normalizeArtistId(artistName) {
  return `local-${String(artistName || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

module.exports = {
  createChatClient,
  createInitialChatState,
  applyAssistantMessage,
  normalizeArtistId,
};

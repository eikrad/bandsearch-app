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

module.exports = {
  createChatClient,
  createInitialChatState,
  applyAssistantMessage,
};

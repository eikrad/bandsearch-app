function normalizeMode(mode) {
  return mode === "preference-aware" ? "preference-aware" : "fresh";
}

function toRenderableRecommendation(item, savedBands) {
  return {
    title: item.artist,
    reason: item.why,
    signals: item.sourceSignals || [],
    country: item.country || "",
    genres: item.genres || [],
    connection: item.connection || "",
    imageUrl: item.imageUrl || null,
    savedBand: savedBands.find((saved) => saved.name === item.artist) || null,
  };
}

function createChatViewModel({ app }) {
  const uiState = {
    mode: "fresh",
    isLoading: false,
    lastMeta: { modeUsed: "fresh", usedPreferenceContext: false },
  };

  return {
    setMode(mode) {
      uiState.mode = normalizeMode(mode);
    },

    getUiState() {
      return { ...uiState };
    },

    async submitQuery(query) {
      uiState.isLoading = true;
      try {
        const response = await app.requestRecommendations(query, uiState.mode);
        uiState.lastMeta = response.meta || uiState.lastMeta;
        return response;
      } finally {
        uiState.isLoading = false;
      }
    },

    getRenderableRecommendations() {
      const appState = app.getState();
      const messages = appState.messages || [];
      const savedBands = appState.savedBands || [];
      const latestAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      const recommendations = latestAssistant?.recommendations || [];
      return recommendations.map((item) => toRenderableRecommendation(item, savedBands));
    },

    getConversationMessages() {
      const appState = app.getState();
      const messages = appState.messages || [];
      const savedBands = appState.savedBands || [];
      const conversation = messages
        .map((msg, index) => {
          if (msg.role === "user") {
            return {
              id: `user-${index}`,
              role: "user",
              content: msg.content || "",
            };
          }

          if (msg.role === "assistant") {
            const cards = (msg.recommendations || []).map((item) => toRenderableRecommendation(item, savedBands));
            const content = typeof msg.content === "string" ? msg.content : "";
            return {
              id: `assistant-${index}`,
              role: "assistant",
              content,
              cards,
            };
          }

          return null;
        })
        .filter(Boolean);

      return conversation.length > 0 ? conversation : null;
    },
  };
}

module.exports = {
  createChatViewModel,
};

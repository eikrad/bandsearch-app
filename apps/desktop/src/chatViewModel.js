function normalizeMode(mode) {
  return mode === "preference-aware" ? "preference-aware" : "fresh";
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
      const messages = app.getState().messages || [];
      const latestAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      const recommendations = latestAssistant?.recommendations || [];
      return recommendations.map((item) => ({
        title: item.artist,
        reason: item.why,
        signals: item.sourceSignals || [],
      }));
    },
  };
}

module.exports = {
  createChatViewModel,
};

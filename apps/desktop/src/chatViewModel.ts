function normalizeMode(mode: string): string {
  return mode === "preference-aware" ? "preference-aware" : "fresh";
}

function toRenderableRecommendation(item: any, savedBands: any[]): any {
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

export function createChatViewModel({ app }: { app: any }) {
  const uiState = {
    mode: "fresh",
    isLoading: false,
    lastMeta: { modeUsed: "fresh", usedPreferenceContext: false } as any,
  };

  return {
    setMode(mode: string) {
      uiState.mode = normalizeMode(mode);
    },

    getUiState() {
      return { ...uiState };
    },

    async submitQuery(query: string) {
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
      const messages: any[] = appState.messages || [];
      const savedBands: any[] = appState.savedBands || [];
      const latestAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      const recommendations: any[] = latestAssistant?.recommendations || [];
      return recommendations.map((item) => toRenderableRecommendation(item, savedBands));
    },

    getConversationMessages() {
      const appState = app.getState();
      const messages: any[] = appState.messages || [];
      const savedBands: any[] = appState.savedBands || [];
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
            const cards = (msg.recommendations || []).map((item: any) => toRenderableRecommendation(item, savedBands));
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

function normalizeViewport(viewport: string): string {
  return viewport === "mobile" ? "mobile" : "desktop";
}

function mapCard(rec: any, viewport: string): any {
  const isDesktop = viewport === "desktop";
  return {
    title: rec.title,
    why: rec.reason,
    country: rec.country || "",
    genres: rec.genres || [],
    connection: rec.connection || "",
    signals: rec.signals || [],
    saved: !!rec.savedBand,
    rating: rec.savedBand?.rating || null,
    actions: {
      save: { visible: isDesktop },
      rate: { visible: isDesktop },
      more: { visible: true },
    },
  };
}

export function createChatScreenModel({ viewModel }: { viewModel: any }) {
  return {
    getScreenState({ viewport = "desktop" }: { viewport?: string } = {}) {
      const resolvedViewport = normalizeViewport(viewport);
      const uiState = viewModel.getUiState();
      const recommendations = viewModel.getRenderableRecommendations();

      return {
        header: {
          title: "Bandsearch",
          subtitle: "Niche music recommendations",
        },
        mode: uiState.mode,
        isLoading: uiState.isLoading,
        lastMeta: uiState.lastMeta,
        recommendationCards: recommendations.map((rec: any) => mapCard(rec, resolvedViewport)),
        conversationMessages:
          typeof viewModel.getConversationMessages === "function"
            ? viewModel.getConversationMessages()
            : null,
      };
    },
  };
}

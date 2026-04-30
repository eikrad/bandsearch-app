function normalizeViewport(viewport) {
  return viewport === "mobile" ? "mobile" : "desktop";
}

function mapCard(rec, viewport) {
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

function createChatScreenModel({ viewModel }) {
  return {
    getScreenState({ viewport = "desktop" } = {}) {
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
        recommendationCards: recommendations.map((rec) => mapCard(rec, resolvedViewport)),
      };
    },
  };
}

module.exports = {
  createChatScreenModel,
};

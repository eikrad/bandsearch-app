function toViewProps(renderState) {
  return {
    headerTitle: renderState.header.title,
    headerSubtitle: renderState.header.subtitle,
    viewport: renderState.viewport || "desktop",
    modeValue: renderState.modeSelector.value,
    modeOptions: renderState.modeSelector.options,
    isLoading: renderState.isLoading,
    queryPlaceholder: renderState.queryInput.placeholder,
    queryDisabled: renderState.queryInput.disabled,
    cards: renderState.recommendationList.items.map((item) => ({
      title: item.title,
      why: item.why || item.reason || "",
      country: item.country || "",
      genres: item.genres || [],
      connection: item.connection || "",
      saved: !!item.saved,
      rating: item.rating || null,
      actions: item.actions || {},
    })),
    emptyText: renderState.recommendationList.emptyText,
  };
}

function createChatRenderAdapter({ desktopUi }) {
  return {
    getViewProps() {
      return toViewProps(desktopUi.getRenderState());
    },
    onModeChange(mode) {
      return toViewProps(desktopUi.handleModeChange(mode));
    },
    async onSubmitQuery(query) {
      const nextState = await desktopUi.handleQuerySubmit(query);
      return toViewProps(nextState);
    },
  };
}

module.exports = {
  createChatRenderAdapter,
};

const { buildPlatformLinks } = require("./platformLinks");

function toCardViewProps(item) {
  return {
    title: item.title,
    why: item.why || item.reason || "",
    country: item.country || "",
    genres: item.genres || [],
    connection: item.connection || "",
    saved: !!item.saved,
    rating: item.rating || null,
    actions: item.actions || {},
    imageUrl: item.imageUrl || null,
    platformLinks: buildPlatformLinks(item.title),
  };
}

function toViewProps(renderState) {
  const threadMessages = Array.isArray(renderState.conversationMessages)
    ? renderState.conversationMessages
      .map((msg) => {
        if (msg.role === "user") {
          return {
            id: msg.id,
            role: "user",
            content: msg.content || "",
          };
        }

        if (msg.role === "assistant") {
          return {
            id: msg.id,
            role: "assistant",
            cards: (msg.cards || []).map((card) => toCardViewProps({
              ...card,
              actions: card.actions || { save: { visible: true }, rate: { visible: true }, more: { visible: true } },
            })),
          };
        }

        return null;
      })
      .filter(Boolean)
    : null;

  return {
    headerTitle: renderState.header.title,
    headerSubtitle: renderState.header.subtitle,
    viewport: renderState.viewport || "desktop",
    modeValue: renderState.modeSelector.value,
    modeOptions: renderState.modeSelector.options,
    isLoading: renderState.isLoading,
    queryPlaceholder: renderState.queryInput.placeholder,
    queryDisabled: renderState.queryInput.disabled,
    cards: renderState.recommendationList.items.map((item) => toCardViewProps(item)),
    messages: threadMessages && threadMessages.length > 0 ? threadMessages : undefined,
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

import { buildPlatformLinks } from "./platformLinks.js";

function toCardViewProps(item: any): any {
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

function toViewProps(renderState: any): any {
  const threadMessages = Array.isArray(renderState.conversationMessages)
    ? renderState.conversationMessages
      .map((msg: any) => {
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
            content: msg.content || "",
            cards: (msg.cards || []).map((card: any) => toCardViewProps({
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
    cards: renderState.recommendationList.items.map((item: any) => toCardViewProps(item)),
    messages: threadMessages && threadMessages.length > 0 ? threadMessages : undefined,
    emptyText: renderState.recommendationList.emptyText,
  };
}

export function createChatRenderAdapter({ desktopUi }: { desktopUi: any }) {
  return {
    getViewProps() {
      return toViewProps(desktopUi.getRenderState());
    },
    onModeChange(mode: string) {
      return toViewProps(desktopUi.handleModeChange(mode));
    },
    async onSubmitQuery(query: string) {
      const nextState = await desktopUi.handleQuerySubmit(query);
      return toViewProps(nextState);
    },
  };
}

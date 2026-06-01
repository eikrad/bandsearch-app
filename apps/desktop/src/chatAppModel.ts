export type RenderableRecommendation = {
  title: string;
  why: string;
  country: string;
  genres: string[];
  signals: string[];
  connection: string;
  imageUrl: string | null;
  saved: boolean;
  rating: number | null;
  savedBandId: string | null;
};

export type ConversationMessage =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string; cards: RenderableRecommendation[] };

export type ChatAppModel = ReturnType<typeof createChatAppModel>;

function toRenderableRecommendation(item: any, savedBands: any[]): RenderableRecommendation {
  const savedBand = savedBands.find((s: any) => s.name === item.artist) ?? null;
  return {
    title: item.artist,
    why: item.why || "",
    country: item.country || "",
    genres: Array.isArray(item.genres) ? item.genres : [],
    signals: Array.isArray(item.sourceSignals) ? item.sourceSignals : [],
    connection: item.connection || "",
    imageUrl: item.imageUrl ?? null,
    saved: savedBand !== null,
    rating: savedBand?.rating ?? null,
    savedBandId: savedBand?.id ?? null,
  };
}

export function createChatAppModel({ app }: { app: any }) {
  let mode = "fresh";
  let obscurityTarget: string | undefined = "underground";
  let loadingState = false;
  let lastMeta: { modeUsed: string; usedPreferenceContext: boolean; eventId?: string } = {
    modeUsed: "fresh",
    usedPreferenceContext: false,
  };
  let showFeedbackBar = false;

  return {
    setMode(next: string) {
      mode = next === "preference-aware" ? "preference-aware" : "fresh";
    },
    getMode() {
      return mode;
    },
    setObscurityTarget(next: string | undefined) {
      obscurityTarget = next;
    },
    getObscurityTarget(): string | undefined {
      return obscurityTarget;
    },
    isLoading() {
      return loadingState;
    },
    getLastMeta() {
      return lastMeta;
    },
    isShowFeedbackBar() {
      return showFeedbackBar;
    },
    dismissFeedbackBar() {
      showFeedbackBar = false;
    },
    async submitQuery(query: string) {
      showFeedbackBar = false;
      loadingState = true;
      try {
        const response = await app.requestRecommendations(query, mode, obscurityTarget) as any;
        lastMeta = response.meta ?? lastMeta;
        if (Array.isArray(response.recommendations) && response.recommendations.length > 0) {
          showFeedbackBar = true;
        }
        return response;
      } finally {
        loadingState = false;
      }
    },
    async submitFeedback(feedbackType: string) {
      showFeedbackBar = false;
      const eventId = lastMeta?.eventId;
      if (!eventId) return;
      await app.sendFeedback(eventId, feedbackType);
    },
    getConversation(): ConversationMessage[] | null {
      const appState = app.getState();
      const messages: any[] = appState.messages || [];
      const savedBands: any[] = appState.savedBands || [];
      if (messages.length === 0) return null;

      const conversation: ConversationMessage[] = [];
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.role === "user") {
          conversation.push({ id: `user-${i}`, role: "user", content: msg.content || "" });
        } else if (msg.role === "assistant") {
          const cards = (Array.isArray(msg.recommendations) ? msg.recommendations : []).map(
            (item: any) => toRenderableRecommendation(item, savedBands),
          );
          conversation.push({
            id: `assistant-${i}`,
            role: "assistant",
            content: typeof msg.content === "string" ? msg.content : "",
            cards,
          });
        }
      }
      return conversation.length > 0 ? conversation : null;
    },
  };
}

import type {
  RecommendationItem,
  RecommendationMeta,
  SavedBand,
  ChatStateMessage,
} from "./domain.js";

export type { RecommendationItem, RecommendationMeta, SavedBand, ChatStateMessage };

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

/** The slice of the bootstrapped app this model drives. */
export type ChatAppCollaborator = {
  requestRecommendations(
    query: string,
    mode: string,
    obscurityTarget: string | undefined,
  ): Promise<{ meta?: RecommendationMeta } | undefined>;
  sendFeedback?(eventId: string, feedbackType: string): Promise<unknown>;
  getState(): { messages?: ChatStateMessage[]; savedBands?: SavedBand[] };
  cancelSearch?(): void;
};

function toRenderableRecommendation(
  item: RecommendationItem,
  savedBands: SavedBand[],
): RenderableRecommendation {
  const savedBand = savedBands.find((s) => s.name === item.artist) ?? null;
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

export function createChatAppModel({ app }: { app: ChatAppCollaborator }) {
  let mode = "fresh";
  let obscurityTarget: string | undefined = "underground";
  let loadingState = false;
  let lastQuery = "";
  let lastMeta: RecommendationMeta = {
    modeUsed: "fresh",
    usedPreferenceContext: false,
  };
  // feedbackDismissed tracks user dismissal; cleared on next query so the bar
  // re-appears after each new recommendation batch.
  let feedbackDismissed = false;

  async function runSubmitQuery(query: string) {
    lastQuery = query;
    feedbackDismissed = false;
    loadingState = true;
    try {
      const response = await app.requestRecommendations(query, mode, obscurityTarget);
      lastMeta = response.meta ?? lastMeta;
      return response;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return; // silent cancel — loadingState reset by finally
      }
      throw error;
    } finally {
      loadingState = false;
    }
  }

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
      return !!lastMeta.eventId && !feedbackDismissed;
    },
    dismissFeedbackBar() {
      feedbackDismissed = true;
    },
    async submitQuery(query: string) {
      return runSubmitQuery(query);
    },
    async retryLastSearch() {
      if (!lastQuery || loadingState) return;
      return runSubmitQuery(lastQuery);
    },
    async submitFeedback(feedbackType: string) {
      feedbackDismissed = true;
      const eventId = lastMeta.eventId;
      if (!eventId) return;
      await app.sendFeedback?.(eventId, feedbackType);
    },
    getConversation(): ConversationMessage[] | null {
      const appState = app.getState();
      const messages: ChatStateMessage[] = appState.messages || [];
      const savedBands: SavedBand[] = appState.savedBands || [];
      if (messages.length === 0) return null;

      const conversation: ConversationMessage[] = [];
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.role === "user") {
          conversation.push({ id: `user-${i}`, role: "user", content: msg.content || "" });
        } else if (msg.role === "assistant") {
          const cards = (Array.isArray(msg.recommendations) ? msg.recommendations : []).map(
            (item) => toRenderableRecommendation(item, savedBands),
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

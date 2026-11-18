import type {
  RecommendationItem,
  RecommendationMeta,
  SavedBand,
  ChatStateMessage,
} from "./domain.js";
import { findSavedBand, type SavedBandTarget } from "./savedBandActions.js";
import {
  validateFeedbackType,
  type RecommendationFeedbackSubmission,
} from "../../../shared/schemas/src/contracts.js";

export type { RecommendationItem, RecommendationMeta, SavedBand, ChatStateMessage };

export type RenderableRecommendation = {
  target: SavedBandTarget;
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
  categories: string[];
  note: string;
  noteEdited: boolean;
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
  ): Promise<{ meta?: RecommendationMeta; recommendations?: RecommendationItem[] }>;
  sendFeedback?(eventId: string, submission: RecommendationFeedbackSubmission): Promise<unknown>;
  getState(): { messages?: ChatStateMessage[]; savedBands?: SavedBand[] };
  cancelSearch?(): void;
};

function toRenderableRecommendation(
  item: RecommendationItem,
  savedBands: SavedBand[],
): RenderableRecommendation {
  const target: SavedBandTarget = {
    name: item.artist,
    musicbrainzArtistId: item.musicbrainzArtistId,
    suggestedNote: item.why,
  };
  const savedBand = findSavedBand(target, savedBands);
  return {
    target,
    title: item.artist,
    why: item.why || "",
    country: item.country || "",
    genres: Array.isArray(item.genres) ? item.genres : [],
    signals: Array.isArray(item.sourceSignals) ? item.sourceSignals : [],
    connection: item.connection || "",
    imageUrl: item.imageUrl ?? null,
    saved: savedBand !== undefined,
    rating: savedBand?.rating ?? null,
    savedBandId: savedBand?.id ?? null,
    categories: savedBand?.categories ?? [],
    note: savedBand?.note ?? item.why ?? "",
    noteEdited: savedBand?.noteEdited ?? false,
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
  // The batch the feedback bar judges, captured as it was asked: changing the
  // mode or target afterwards must not rewrite what the verdict was about.
  let lastBatch: { eventId: string; context: Omit<RecommendationFeedbackSubmission, "feedbackType"> } | null = null;

  async function runSubmitQuery(query: string) {
    lastQuery = query;
    feedbackDismissed = false;
    loadingState = true;
    const askedMode = mode;
    const askedTarget = obscurityTarget;
    try {
      const response = await app.requestRecommendations(query, askedMode, askedTarget);
      lastMeta = response.meta ?? lastMeta;
      lastBatch = response.meta?.eventId
        ? {
            eventId: response.meta.eventId,
            context: {
              query,
              mode: askedMode,
              obscurityTarget: askedTarget ?? null,
              bandNames: (response.recommendations ?? []).map((item) => item.artist),
            },
          }
        : null;
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
    cancelSearch() {
      app.cancelSearch?.();
    },
    /** Closes the bar and sends the verdict; a refusal reaches the caller. */
    async submitFeedback(feedbackType: string) {
      feedbackDismissed = true;
      const verdict = validateFeedbackType(feedbackType);
      if (!lastBatch || !verdict) return;
      await app.sendFeedback?.(lastBatch.eventId, { feedbackType: verdict, ...lastBatch.context });
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

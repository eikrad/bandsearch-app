import { formatRatingForPrompt, type AnswerProgress, type RecommendationFeedbackSubmission } from "../../../shared/schemas/src/contracts.js";
import type { SavedBand } from "./domain.js";
import type { ChatMessage } from "./chatClient.js";
import {
  createChatClient,
  createInitialChatState,
  applyAssistantMessage,
} from "./chatClient.js";
import { createSavedBandActions } from "./savedBandActions.js";

type DesktopAppState = {
  messages: ChatMessage[];
  savedBands: SavedBand[];
  selectedArtistIds: string[];
  currentSessionId: string | null;
  /** The answer being made; null when there is none. */
  pending: PendingAnswer | null;
};

/** What is known of an answer before it is complete. */
export type PendingAnswer = { progress: AnswerProgress | null; reply: string };

function buildPriorityContext(savedBands: SavedBand[], selectedArtistIds: string[]): string {
  if (!selectedArtistIds.length) return "";
  const selected = savedBands.filter((b) => selectedArtistIds.includes(b.id));
  if (!selected.length) return "";
  const names = selected.map((b) => `${b.name} (${formatRatingForPrompt(b.rating)})`).join(", ");
  return `Priority style references: ${names}`;
}

function newConversationId(): string {
  // randomUUID exists only in secure contexts; this id needs to be unlikely to repeat, not secret.
  return globalThis.crypto?.randomUUID?.() ?? `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export type BootstrapDesktopAppOptions = {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  getToken?: (() => string | null) | null;
  onSessionResolved?: ((sessionId: string) => void) | null;
};

export function bootstrapDesktopApp({
  apiBaseUrl = "http://localhost:3001",
  fetchImpl,
  getToken = null,
  onSessionResolved = null,
}: BootstrapDesktopAppOptions = {}) {
  const chatClient = createChatClient({ apiBaseUrl, fetchImpl: fetchImpl ?? fetch, getToken });
  let state: DesktopAppState = {
    ...createInitialChatState(),
    savedBands: [],
    selectedArtistIds: [],
    currentSessionId: null,
    pending: null,
  };
  const listeners = new Set<() => void>();
  function setPending(pending: PendingAnswer | null) {
    state = { ...state, pending };
    for (const listener of listeners) listener();
  }

  let pendingSelectedArtistIds: string[] = [];
  let currentAbortController: AbortController | null = null;
  // Names the conversation to the API from its first message on, before any
  // session is saved. A resumed one keeps its session's id.
  let conversationId: string | null = null;
  // Saving runs behind the conversation, one message after the other, and never
  // delays an answer.
  let saving: Promise<unknown> = Promise.resolve();
  // The question saved to a session that has no saved answer yet, so a retry
  // does not record it a second time. Keyed by session: a new chat must save it.
  let persistedQuestion: { sessionId: string; query: string } | null = null;

  // Created lazily on the first message rather than at app boot: creating one
  // eagerly on every launch would leave orphaned empty sessions for anyone who
  // opens the app and never chats, and would need a network round trip before
  // the window can even render. Not memoized across calls: a failed or
  // aborted attempt must be retried on the next message, not cached as a
  // permanent "no session" result.
  async function ensureSession(signal?: AbortSignal): Promise<string | null> {
    if (state.currentSessionId) return state.currentSessionId;
    try {
      const created = await chatClient.createSession(undefined, signal);
      state = { ...state, currentSessionId: created.session.id };
      onSessionResolved?.(created.session.id);
      return created.session.id;
    } catch {
      return null; // chat still works this run, just without persistence
    }
  }

  const savedBandActions = createSavedBandActions({
    client: chatClient,
    getSavedBands: () => state.savedBands,
    setSavedBands: (savedBands) => { state = { ...state, savedBands }; },
  });

  return {
    ...savedBandActions,
    getState() { return state; },
    /** Calls `listener` when an answer makes progress. Returns an unsubscribe. */
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setPendingStyleRef(ids: string[]) {
      pendingSelectedArtistIds = Array.isArray(ids) ? [...ids] : [];
    },
    async startSession(title = "Untitled") {
      const result = await chatClient.createSession(title);
      state = { ...state, currentSessionId: result.session.id };
      conversationId = result.session.id;
      return result.session;
    },
    async listSessions() {
      const result = await chatClient.listSessions();
      return result.sessions;
    },
    /**
     * Hydrates the conversation from a previously persisted session id (e.g.
     * one restored from local storage after an app restart). A missing or
     * unreadable session is not an error — the caller keeps a blank chat and
     * a fresh session gets created lazily on the next message.
     */
    async resumeSession(sessionId: string): Promise<boolean> {
      const existing = await chatClient.getSession(sessionId).catch(() => null);
      if (!existing) return false;
      conversationId = existing.session.id;
      state = {
        ...state,
        currentSessionId: existing.session.id,
        messages: existing.messages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })),
      };
      return true;
    },
    async requestRecommendations(query: string, mode = "fresh", obscurityTarget?: string) {
      const effectiveIds =
        pendingSelectedArtistIds.length > 0 ? [...pendingSelectedArtistIds] : state.selectedArtistIds;
      if (pendingSelectedArtistIds.length > 0) pendingSelectedArtistIds = [];
      let priorityContext = buildPriorityContext(state.savedBands, effectiveIds);
      if (mode === "preference-aware" && effectiveIds.length > 0) priorityContext = "";
      // Retrying a failed question re-runs it: the unanswered message is reused,
      // not shown twice or sent again as history.
      const messages = state.messages || [];
      const last = messages[messages.length - 1];
      const earlier = last?.role === "user" && last.content === query ? messages.slice(0, -1) : messages;
      const conversationHistory = earlier.flatMap((m) => {
        if (m.role === "user") return [{ role: "user", content: m.content }];
        if (m.role === "assistant") {
          const text =
            typeof m.content === "string" && m.content.trim()
              ? m.content
              : m.recommendations
                ? m.recommendations.map((r) => r.artist).join(", ")
                : "";
          return [{ role: "assistant", content: text }];
        }
        return [];
      });
      state = { ...state, messages: [...earlier, { role: "user", content: query }], pending: { progress: null, reply: "" } };
      const controller = new AbortController();
      currentAbortController = controller;
      conversationId ??= newConversationId();
      const asked = conversationId;
      // Persistence is best-effort: a failed write must not break the chat, so
      // errors are swallowed rather than surfaced to the caller.
      const save = (task: (sessionId: string) => Promise<unknown>) => {
        saving = saving.then(async () => {
          const sessionId = await ensureSession(controller.signal);
          if (sessionId) await task(sessionId);
        }).catch(() => {});
      };
      save(async (sessionId) => {
        if (persistedQuestion?.sessionId === sessionId && persistedQuestion.query === query) return;
        await chatClient.appendSessionMessage(sessionId, { role: "user", content: query }, controller.signal);
        persistedQuestion = { sessionId, query };
      });
      try {
        const result = await chatClient.fetchRecommendations({
          query,
          mode,
          priorityContext,
          messages: conversationHistory,
          selectedArtistIds: effectiveIds,
          obscurityTarget,
          conversationId: asked,
          signal: controller.signal,
          onEvent: (event) => {
            // Each stage starts its own reply: one that led nowhere must not stay on screen.
            if (event.type === "progress") setPending({ progress: event.progress, reply: "" });
            if (event.type === "reply") setPending({ progress: state.pending?.progress ?? null, reply: event.text });
          },
        });
        state = applyAssistantMessage(state, result);
        const { content } = state.messages[state.messages.length - 1]!;
        save(async (sessionId) => {
          await chatClient.appendSessionMessage(sessionId, { role: "assistant", content }, controller.signal);
          persistedQuestion = null;
        });
        return result;
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          state = { ...state, messages: (state.messages || []).slice(0, -1) };
        }
        throw error;
      } finally {
        state = { ...state, pending: null };
        currentAbortController = null;
      }
    },
    async sendFeedback(eventId: string, submission: RecommendationFeedbackSubmission) {
      return chatClient.sendFeedback(eventId, submission);
    },
    cancelSearch() {
      currentAbortController?.abort();
    },
    toggleArtistSelection(id: string) {
      const ids: string[] = state.selectedArtistIds;
      if (ids.includes(id)) {
        state = { ...state, selectedArtistIds: ids.filter((x) => x !== id) };
      } else {
        state = { ...state, selectedArtistIds: [...ids, id] };
      }
    },
    clearArtistSelection() {
      state = { ...state, selectedArtistIds: [] };
    },
    async listSavedBands() {
      const bands = await chatClient.listPreferences();
      state = { ...state, savedBands: bands };
      return bands;
    },
    async searchArtists(query: string) {
      const result = await chatClient.searchArtists(query);
      return result.artists || [];
    },
    async exportPreferences() {
      return chatClient.exportPreferences();
    },
    async importPreferences(bands: unknown[]) {
      return chatClient.importPreferences(bands);
    },
    async listGroups() {
      return chatClient.listGroups();
    },
    async createGroup(name: string) {
      return chatClient.createGroup(name);
    },
    async deleteGroup(id: string) {
      return chatClient.deleteGroup(id);
    },
    async autoGroup() {
      return chatClient.autoGroup();
    },
  };
}

import { formatRatingForPrompt } from "../../../shared/schemas/src/contracts.js";
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
};

function buildPriorityContext(savedBands: SavedBand[], selectedArtistIds: string[]): string {
  if (!selectedArtistIds.length) return "";
  const selected = savedBands.filter((b) => selectedArtistIds.includes(b.id));
  if (!selected.length) return "";
  const names = selected.map((b) => `${b.name} (${formatRatingForPrompt(b.rating)})`).join(", ");
  return `Priority style references: ${names}`;
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
  };
  let pendingSelectedArtistIds: string[] = [];
  let currentAbortController: AbortController | null = null;

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
    setPendingStyleRef(ids: string[]) {
      pendingSelectedArtistIds = Array.isArray(ids) ? [...ids] : [];
    },
    async startSession(title = "Untitled") {
      const result = await chatClient.createSession(title);
      state = { ...state, currentSessionId: result.session.id };
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
      const conversationHistory = (state.messages || []).flatMap((m) => {
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
      state = { ...state, messages: [...(state.messages || []), { role: "user", content: query }] };
      const controller = new AbortController();
      currentAbortController = controller;
      try {
        const sessionId = await ensureSession(controller.signal);
        // A cancel that landed while ensureSession was in flight leaves the
        // signal permanently aborted; starting another fetch on it here would
        // wait on an "abort" event that already fired and will not fire
        // again, so bail out the same way a mid-flight cancel would.
        if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
        // Persistence is best-effort: a failed write here must not break the
        // chat, so errors are swallowed rather than surfaced to the caller.
        if (sessionId) {
          await chatClient
            .appendSessionMessage(sessionId, { role: "user", content: query }, controller.signal)
            .catch(() => {});
        }
        const result = await chatClient.fetchRecommendations(
          query, mode, priorityContext, conversationHistory, effectiveIds, obscurityTarget, controller.signal,
        );
        state = applyAssistantMessage(state, result);
        if (sessionId) {
          const assistantMessage = state.messages[state.messages.length - 1];
          await chatClient
            .appendSessionMessage(sessionId, { role: "assistant", content: assistantMessage.content }, controller.signal)
            .catch(() => {});
        }
        return result;
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          state = { ...state, messages: (state.messages || []).slice(0, -1) };
        }
        throw error;
      } finally {
        currentAbortController = null;
      }
    },
    async sendFeedback(eventId: string, feedbackType: string) {
      return chatClient.sendFeedback(eventId, feedbackType);
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

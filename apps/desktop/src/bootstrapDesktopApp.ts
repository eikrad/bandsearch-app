import { formatRatingForPrompt } from "../../../shared/schemas/src/contracts.js";
import type { SavedBand } from "./domain.js";
import type { ChatMessage } from "./chatClient.js";
import {
  createChatClient,
  createInitialChatState,
  applyAssistantMessage,
  normalizeArtistId,
} from "./chatClient.js";

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

  function findLatestRecommendationByName(artistName: string) {
    const messages = state.messages || [];
    const latestAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    const recommendations = latestAssistant?.recommendations || [];
    return recommendations.find((item) => item.artist === artistName);
  }

  // The same id saveBand sends the server, so a lookup against state.savedBands
  // agrees with what actually got stored — matching by name instead let two
  // different artists sharing a name collide, and missed a stale client cache
  // entirely (#163).
  function resolveMusicbrainzId(artistName: string): string {
    const recommendation = findLatestRecommendationByName(artistName);
    const mbFromCard =
      recommendation?.musicbrainzArtistId && String(recommendation.musicbrainzArtistId).trim()
        ? String(recommendation.musicbrainzArtistId).trim()
        : null;
    return mbFromCard || normalizeArtistId(artistName);
  }

  function findSavedBandByArtist(artistName: string): SavedBand | undefined {
    const musicbrainzArtistId = resolveMusicbrainzId(artistName);
    return state.savedBands.find((item) => item.musicbrainzArtistId === musicbrainzArtistId);
  }

  function upsertSavedBand(savedBand: SavedBand) {
    const existingIndex = state.savedBands.findIndex((item) => item.id === savedBand.id);
    if (existingIndex >= 0) {
      const nextSavedBands = [...state.savedBands];
      nextSavedBands[existingIndex] = savedBand;
      state = { ...state, savedBands: nextSavedBands };
      return;
    }
    state = { ...state, savedBands: [...state.savedBands, savedBand] };
  }

  return {
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
    async saveBand(artistName: string, options: { rating?: number; categories?: string[]; note?: string } = {}) {
      const recommendation = findLatestRecommendationByName(artistName);
      const payload = {
        musicbrainzArtistId: resolveMusicbrainzId(artistName),
        name: artistName,
        // No rating unless the user gave one. This used to default to 3,
        // so every "just remember this" became a three-star judgement
        // nobody made and nobody saw (#164).
        rating: options.rating ?? null,
        categories: options.categories || [],
        note: options.note || recommendation?.why || "Saved from recommendation card.",
      };
      // The server itself dedupes on (user, musicbrainzArtistId) (#163), so a
      // repeat call updates the existing row rather than creating a second
      // one — this just needs to hand back that same row, not skip the call.
      const result = await chatClient.createPreference(payload);
      upsertSavedBand(result.savedBand);
      return result.savedBand;
    },
    // Tapping a star implies saving (UI_GUIDELINES.md — "rating implies
    // saving"); tapping the currently active star clears it via rating: null,
    // which stays saved and only drops the judgement.
    async rateBand(artistName: string, rating: number | null = 5) {
      let savedBand = findSavedBandByArtist(artistName);
      if (!savedBand) savedBand = await this.saveBand(artistName, rating != null ? { rating } : {});
      const result = await chatClient.updatePreference(savedBand.id, { rating });
      upsertSavedBand(result.savedBand);
      return result.savedBand;
    },
    // The ··· sheet's Category/Note edit. Editing implies saving, same as
    // rating — an artist not yet saved gets created with these fields instead
    // of failing for lack of a savedBandId.
    async saveCategoryNote(
      artistName: string,
      savedBandId: string | null,
      updates: { categories: string[]; note: string },
    ) {
      if (savedBandId) {
        const result = await chatClient.updatePreference(savedBandId, updates);
        upsertSavedBand(result.savedBand);
        return result.savedBand;
      }
      return this.saveBand(artistName, updates);
    },
    async listSavedBands() {
      const bands = await chatClient.listPreferences();
      state = { ...state, savedBands: bands };
      return bands;
    },
    async deleteSavedBand(id: string) {
      await chatClient.deletePreference(id);
      state = { ...state, savedBands: state.savedBands.filter((b) => b.id !== id) };
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

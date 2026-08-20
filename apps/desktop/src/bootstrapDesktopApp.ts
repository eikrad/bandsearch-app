import type { SavedBand } from "./domain.js";
import type { ChatMessage } from "./chatClient.js";
import {
  createChatClient,
  createInitialChatState,
  applyAssistantMessage,
  normalizeArtistId,
} from "./chatClient.js";

const VALID_VIEWS = ["chat", "saved-artists"];

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
  const names = selected.map((b) => `${b.name} (rating ${b.rating}/5)`).join(", ");
  return `Priority style references: ${names}`;
}

export type BootstrapDesktopAppOptions = {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  getToken?: (() => string | null) | null;
};

export function bootstrapDesktopApp({
  apiBaseUrl = "http://localhost:3001",
  fetchImpl,
  getToken = null,
}: BootstrapDesktopAppOptions = {}) {
  const chatClient = createChatClient({ apiBaseUrl, fetchImpl: fetchImpl ?? fetch, getToken });
  let state: DesktopAppState = {
    ...createInitialChatState(),
    savedBands: [],
    selectedArtistIds: [],
    currentSessionId: null,
  };
  let currentView = "chat";
  let pendingSelectedArtistIds: string[] = [];
  let currentAbortController: AbortController | null = null;

  function findLatestRecommendationByName(artistName: string) {
    const messages = state.messages || [];
    const latestAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    const recommendations = latestAssistant?.recommendations || [];
    return recommendations.find((item) => item.artist === artistName);
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
    getView() { return currentView; },
    navigate(view: string) {
      if (!VALID_VIEWS.includes(view)) return;
      currentView = view;
    },
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
        const result = await chatClient.fetchRecommendations(
          query, mode, priorityContext, conversationHistory, effectiveIds, obscurityTarget, controller.signal,
        );
        state = applyAssistantMessage(state, result);
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
      const mbFromCard =
        recommendation?.musicbrainzArtistId && String(recommendation.musicbrainzArtistId).trim()
          ? String(recommendation.musicbrainzArtistId).trim()
          : null;
      const payload = {
        musicbrainzArtistId: mbFromCard || normalizeArtistId(artistName),
        name: artistName,
        rating: options.rating || 3,
        categories: options.categories || [],
        note: options.note || recommendation?.why || "Saved from recommendation card.",
      };
      const result = await chatClient.createPreference(payload);
      upsertSavedBand(result.savedBand);
      return result.savedBand;
    },
    async rateBand(artistName: string, rating = 5) {
      let savedBand = state.savedBands.find((item) => item.name === artistName);
      if (!savedBand) savedBand = await this.saveBand(artistName, { rating });
      const result = await chatClient.updatePreference(savedBand.id, { rating });
      upsertSavedBand(result.savedBand);
      return result.savedBand;
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

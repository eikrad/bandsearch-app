const {
  createChatClient,
  createInitialChatState,
  applyAssistantMessage,
  normalizeArtistId,
} = require("./chatClient");

const VALID_VIEWS = ["chat", "saved-artists"];

function buildPriorityContext(savedBands, selectedArtistIds) {
  if (!selectedArtistIds.length) return "";
  const selected = savedBands.filter((b) => selectedArtistIds.includes(b.id));
  if (!selected.length) return "";
  const names = selected.map((b) => `${b.name} (rating ${b.rating}/5)`).join(", ");
  return `Priority style references: ${names}`;
}

/**
 * Desktop shell state + API client — HTTP orchestration for chat and saved bands.
 *
 * @param {{ apiBaseUrl?: string, fetchImpl?: any }} [options]
 */
function bootstrapDesktopApp({ apiBaseUrl = "http://localhost:3001", fetchImpl } = {}) {
  const chatClient = createChatClient({ apiBaseUrl, fetchImpl });
  let state = { ...createInitialChatState(), savedBands: [], selectedArtistIds: [], currentSessionId: null };
  let currentView = "chat";
  let pendingSelectedArtistIds = [];

  function findLatestRecommendationByName(artistName) {
    const messages = state.messages || [];
    const latestAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    const recommendations = latestAssistant?.recommendations || [];
    return recommendations.find((item) => item.artist === artistName);
  }

  function upsertSavedBand(savedBand) {
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
    getState() {
      return state;
    },
    getView() {
      return currentView;
    },
    navigate(view) {
      if (!VALID_VIEWS.includes(view)) return;
      currentView = view;
    },
    setPendingStyleRef(ids) {
      pendingSelectedArtistIds = Array.isArray(ids) ? [...ids] : [];
    },
    async startSession(title = "Untitled") {
      const result = /** @type {any} */ (await chatClient.createSession(title));
      state = { ...state, currentSessionId: result.session.id };
      return result.session;
    },
    async listSessions() {
      const result = /** @type {any} */ (await chatClient.listSessions());
      return result.sessions;
    },
    async requestRecommendations(query, mode = "fresh") {
      const effectiveIds =
        pendingSelectedArtistIds.length > 0 ? [...pendingSelectedArtistIds] : state.selectedArtistIds;
      if (pendingSelectedArtistIds.length > 0) pendingSelectedArtistIds = [];
      let priorityContext = buildPriorityContext(state.savedBands, effectiveIds);
      if (mode === "preference-aware" && effectiveIds.length > 0) {
        priorityContext = "";
      }
      const conversationHistory = (state.messages || []).flatMap((m) => {
        if (m.role === "user") return [{ role: "user", content: m.content }];
        if (m.role === "assistant" && m.recommendations) {
          return [{ role: "assistant", content: m.recommendations.map((r) => r.artist).join(", ") }];
        }
        return [];
      });
      state = { ...state, messages: [...(state.messages || []), { role: "user", content: query }] };
      const result = await chatClient.fetchRecommendations(
        query,
        mode,
        priorityContext,
        conversationHistory,
        effectiveIds,
      );
      state = applyAssistantMessage(state, result);
      return result;
    },
    toggleArtistSelection(id) {
      const ids = state.selectedArtistIds;
      if (ids.includes(id)) {
        state = { ...state, selectedArtistIds: ids.filter((x) => x !== id) };
      } else {
        state = { ...state, selectedArtistIds: [...ids, id] };
      }
    },
    async saveBand(artistName, options = {}) {
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
      const result = /** @type {any} */ (await chatClient.createPreference(payload));
      upsertSavedBand(result.savedBand);
      return result.savedBand;
    },
    async rateBand(artistName, rating = 5) {
      let savedBand = state.savedBands.find((item) => item.name === artistName);
      if (!savedBand) {
        savedBand = await this.saveBand(artistName, { rating });
      }
      const result = /** @type {any} */ (await chatClient.updatePreference(savedBand.id, { rating }));
      upsertSavedBand(result.savedBand);
      return result.savedBand;
    },
    async listSavedBands() {
      const bands = await chatClient.listPreferences();
      state = { ...state, savedBands: bands };
      return bands;
    },
    async deleteSavedBand(id) {
      await chatClient.deletePreference(id);
      state = { ...state, savedBands: state.savedBands.filter((b) => b.id !== id) };
    },
    async searchArtists(query) {
      const result = /** @type {any} */ (await chatClient.searchArtists(query));
      return result.artists || [];
    },
  };
}

module.exports = {
  bootstrapDesktopApp,
};

const {
  createChatClient,
  createInitialChatState,
  applyAssistantMessage,
  normalizeArtistId,
} = require("./chatClient");
const { createChatViewModel } = require("./chatViewModel");
const { createChatScreenModel } = require("./chatScreenModel");
const { createChatScreen } = require("./chatScreen");
const { createChatRenderAdapter } = require("./chatRenderAdapter");
const { createSavedArtistsModel } = require("./savedArtistsModel");
const { createDesktopReactShell } = require("./ui/createDesktopReactShell");
const { createDesktopReactMount } = require("./ui/mountDesktopReactApp");

const VALID_VIEWS = ["chat", "saved-artists"];

function buildPriorityContext(savedBands, selectedArtistIds) {
  if (!selectedArtistIds.length) return "";
  const selected = savedBands.filter((b) => selectedArtistIds.includes(b.id));
  if (!selected.length) return "";
  const names = selected.map((b) => `${b.name} (rating ${b.rating}/5)`).join(", ");
  return `Priority style references: ${names}`;
}

/**
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
      const priorityContext = buildPriorityContext(state.savedBands, effectiveIds);
      const conversationHistory = (state.messages || []).flatMap((m) => {
        if (m.role === "user") return [{ role: "user", content: m.content }];
        if (m.role === "assistant" && m.recommendations) {
          return [{ role: "assistant", content: m.recommendations.map((r) => r.artist).join(", ") }];
        }
        return [];
      });
      state = { ...state, messages: [...(state.messages || []), { role: "user", content: query }] };
      const result = await chatClient.fetchRecommendations(query, mode, priorityContext, conversationHistory);
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
      const payload = {
        musicbrainzArtistId: normalizeArtistId(artistName),
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

function bootstrapDesktopUi({ app, viewport = "desktop" }) {
  const viewModel = createChatViewModel({ app });
  const screenModel = createChatScreenModel({ viewModel });
  const screen = createChatScreen({ viewModel, screenModel });

  return {
    getRenderState() {
      return screen.getRenderState({ viewport });
    },
    handleModeChange(mode) {
      screen.handleModeChange(mode);
      return screen.getRenderState({ viewport });
    },
    async handleQuerySubmit(query) {
      await screen.handleQuerySubmit(query);
      return screen.getRenderState({ viewport });
    },
  };
}

function bootstrapDesktopRenderAdapter({ app, viewport = "desktop" }) {
  const desktopUi = bootstrapDesktopUi({ app, viewport });
  return createChatRenderAdapter({ desktopUi });
}

function bootstrapDesktopReactShell({ app, viewport = "desktop", actionHandlers = {} }) {
  const renderAdapter = bootstrapDesktopRenderAdapter({ app, viewport });
  const savedArtistsModel = createSavedArtistsModel({ app });
  const resolvedActionHandlers = /** @type {any} */ (actionHandlers);
  const mergedActionHandlers = {
    onSave: resolvedActionHandlers.onSave || ((artistName) => app.saveBand?.(artistName)),
    onRate: resolvedActionHandlers.onRate || ((artistName) => app.rateBand?.(artistName, 5)),
    onMore: resolvedActionHandlers.onMore || (() => {}),
  };
  return createDesktopReactShell({
    renderAdapter,
    actionHandlers: mergedActionHandlers,
    getViewImpl: () => app.getView?.() ?? "chat",
    navigateImpl: async (view) => {
      app.navigate?.(view);
      if (view === "saved-artists") {
        await savedArtistsModel.loadSavedArtists();
      }
    },
    searchArtistsImpl: (query) => savedArtistsModel.searchArtists(query),
    toggleSelectionImpl: (id) => savedArtistsModel.toggleSelection(id),
    deleteSavedArtistImpl: (id) => savedArtistsModel.deleteSavedArtist(id),
    activateStyleRefImpl: async () => {
      const ids = savedArtistsModel.getSelectedIds();
      savedArtistsModel.clearSelection();
      app.setPendingStyleRef?.(ids);
      app.navigate?.("chat");
    },
    getSavedArtistsViewPropsImpl: () => savedArtistsModel.getScreenState(),
  });
}

function bootstrapDesktopReactApp({ app, viewport = "desktop", actionHandlers = {}, router = null, savedArtistsShell = null }) {
  const shell = bootstrapDesktopReactShell({ app, viewport, actionHandlers });
  return createDesktopReactMount({ shell, router, savedArtistsShell });
}

module.exports = {
  bootstrapDesktopApp,
  bootstrapDesktopUi,
  bootstrapDesktopRenderAdapter,
  bootstrapDesktopReactShell,
  bootstrapDesktopReactApp,
};

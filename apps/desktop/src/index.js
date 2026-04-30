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
const { createDesktopReactShell } = require("./ui/createDesktopReactShell");
const { createDesktopReactMount } = require("./ui/mountDesktopReactApp");

/**
 * @param {{ apiBaseUrl?: string, fetchImpl?: any }} [options]
 */
function bootstrapDesktopApp({ apiBaseUrl = "http://localhost:3001", fetchImpl } = {}) {
  const chatClient = createChatClient({ apiBaseUrl, fetchImpl });
  let state = { ...createInitialChatState(), savedBands: [] };

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
    async requestRecommendations(query, mode = "fresh") {
      const result = await chatClient.fetchRecommendations(query, mode);
      state = applyAssistantMessage(state, result);
      return result;
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
  const resolvedActionHandlers = /** @type {any} */ (actionHandlers);
  const mergedActionHandlers = {
    onSave: resolvedActionHandlers.onSave || ((artistName) => app.saveBand?.(artistName)),
    onRate: resolvedActionHandlers.onRate || ((artistName) => app.rateBand?.(artistName, 5)),
    onMore: resolvedActionHandlers.onMore || (() => {}),
  };
  return createDesktopReactShell({ renderAdapter, actionHandlers: mergedActionHandlers });
}

function bootstrapDesktopReactApp({ app, viewport = "desktop", actionHandlers = {} }) {
  const shell = bootstrapDesktopReactShell({ app, viewport, actionHandlers });
  return createDesktopReactMount({ shell });
}

module.exports = {
  bootstrapDesktopApp,
  bootstrapDesktopUi,
  bootstrapDesktopRenderAdapter,
  bootstrapDesktopReactShell,
  bootstrapDesktopReactApp,
};

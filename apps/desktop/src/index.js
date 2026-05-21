const { createChatRenderAdapter } = require("./chatRenderAdapter");
const { createSavedArtistsModel } = require("./savedArtistsModel");
const { createDesktopReactShell } = require("./ui/createDesktopReactShell");
const { createDesktopReactMount } = require("./ui/mountDesktopReactApp");
const { createDesktopChatUiStack } = require("./desktopChatUiStack");
const { bootstrapDesktopApp } = require("./bootstrapDesktopApp");

function bootstrapDesktopUi(options) {
  return createDesktopChatUiStack(options);
}

function bootstrapDesktopRenderAdapter({ app, viewport = "desktop" }) {
  const desktopUi = bootstrapDesktopUi({ app, viewport });
  const adapter = createChatRenderAdapter({ desktopUi });
  adapter.desktopUi = desktopUi;
  return adapter;
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
  const shell = createDesktopReactShell({
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
  shell.desktopUi = renderAdapter.desktopUi;
  return shell;
}

/**
 * @param {{
 *   app?: object,
 *   viewport?: string,
 *   actionHandlers?: Record<string, unknown>,
 *   router?: unknown,
 *   savedArtistsShell?: unknown,
 *   getSettingsViewProps?: () => Promise<any>,
 *   saveGeminiApiKey?: (apiKey: string) => Promise<void>,
 *   saveBraveApiKey?: (apiKey: string) => Promise<void>,
 *   completeOnboarding?: () => Promise<void>,
 * }} [options]
 */
function bootstrapDesktopReactApp(options = {}) {
  const {
    app,
    viewport = "desktop",
    actionHandlers = {},
    router = null,
    savedArtistsShell = null,
    getSettingsViewProps,
    saveGeminiApiKey,
    saveBraveApiKey,
    completeOnboarding,
  } = options;
  const shell = bootstrapDesktopReactShell({ app, viewport, actionHandlers });
  const mountApi = createDesktopReactMount({
    shell,
    router,
    savedArtistsShell,
    getSettingsViewProps,
    saveGeminiApiKey,
    saveBraveApiKey,
    completeOnboarding,
  });
  return {
    ...mountApi,
    desktopUi: shell.desktopUi,
    refreshView() {
      return mountApi.mount();
    },
  };
}

module.exports = {
  bootstrapDesktopApp,
  bootstrapDesktopUi,
  bootstrapDesktopRenderAdapter,
  bootstrapDesktopReactShell,
  bootstrapDesktopReactApp,
};

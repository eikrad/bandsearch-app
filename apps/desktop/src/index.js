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

/**
 * @param {{
 *   app?: object,
 *   viewport?: string,
 *   actionHandlers?: Record<string, unknown>,
 *   router?: unknown,
 *   savedArtistsShell?: unknown,
 *   getSettingsViewProps?: () => Promise<any>,
 *   saveGeminiApiKey?: (apiKey: string) => Promise<void>,
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
  } = options;
  const shell = bootstrapDesktopReactShell({ app, viewport, actionHandlers });
  return createDesktopReactMount({
    shell,
    router,
    savedArtistsShell,
    getSettingsViewProps,
    saveGeminiApiKey,
  });
}

module.exports = {
  bootstrapDesktopApp,
  bootstrapDesktopUi,
  bootstrapDesktopRenderAdapter,
  bootstrapDesktopReactShell,
  bootstrapDesktopReactApp,
};

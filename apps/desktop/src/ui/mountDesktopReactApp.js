const React = require("react");
const { createRoot } = require("react-dom/client");
const { ChatAppView } = require("./ChatAppView");
const { SavedArtistsView } = require("./SavedArtistsView");
const { SettingsView } = require("./SettingsView");

function defaultContainerResolver() {
  /** @type {any} */ const browserDocument = globalThis.document;
  const root = browserDocument?.getElementById("root");
  if (!root) {
    throw new Error("missing root container");
  }
  return root;
}

function resolveViewComponent(viewName) {
  if (viewName === "saved-artists") return SavedArtistsView;
  return ChatAppView;
}

/**
 * @param {{
 *   shell: object,
 *   router?: object | null,
 *   savedArtistsShell?: object | null,
 *   getSettingsViewProps?: () => any,
 *   saveGeminiApiKey?: (apiKey: string) => Promise<void>,
 *   createRootImpl?: typeof import("react-dom/client").createRoot,
 *   resolveContainer?: () => HTMLElement,
 * }} options
 */
function createDesktopReactMount({
  shell,
  router = null,
  savedArtistsShell = null,
  getSettingsViewProps = () => ({
    headerTitle: "Settings",
    headerSubtitle: "",
    hasStoredKey: false,
    statusMessage: null,
  }),
  saveGeminiApiKey = async (apiKey) => {
    void apiKey;
  },
  createRootImpl = createRoot,
  resolveContainer = defaultContainerResolver,
}) {
  const container = resolveContainer();
  const root = createRootImpl(container);

  async function renderCurrent() {
    const route = router ? router.getRoute() : "home";

    if (route === "saved" && savedArtistsShell) {
      const viewProps = savedArtistsShell.getViewProps();
      root.render(
        React.createElement(SavedArtistsView, {
          viewProps,
          handlers: savedHandlers,
        }),
      );
      return viewProps;
    }

    if (route === "settings") {
      const viewProps = await Promise.resolve(getSettingsViewProps());
      root.render(
        React.createElement(SettingsView, {
          viewProps,
          handlers: settingsHandlers,
        }),
      );
      return viewProps;
    }

    const viewProps = shell.getViewProps();
    const currentView = shell.getView?.() ?? "chat";
    const ViewComponent = resolveViewComponent(currentView);
    root.render(React.createElement(ViewComponent, { viewProps, handlers }));
    return viewProps;
  }

  const handlers = {
    onModeChange: async (mode) => {
      await shell.updateMode(mode);
      return renderCurrent();
    },
    onQuerySubmit: async (query) => {
      try {
        const pending = shell.submitQuery(query);
        await renderCurrent();
        await pending;
      } catch {
        // Error is surfaced via actionStatus in the shell; always re-render.
      }
      return renderCurrent();
    },
    onSave: (artistName) => {
      return Promise.resolve(shell.saveBand?.(artistName)).then(() => renderCurrent());
    },
    onRate: (artistName) => {
      return Promise.resolve(shell.rateBand?.(artistName, 5)).then(() => renderCurrent());
    },
    onMore: (artistName) => {
      void artistName;
    },
    onDelete: async (id) => {
      try {
        await shell.deleteSavedArtist?.(id);
      } catch {
        // Error surfaced via actionStatus
      }
      return renderCurrent();
    },
    onToggleSelection: (id) => {
      shell.toggleSelection?.(id);
      return renderCurrent();
    },
    onActivateStyleRef: async () => {
      await shell.activateStyleRef?.();
      return renderCurrent();
    },
    onSearch: async (query) => {
      await shell.searchArtists?.(query);
      return renderCurrent();
    },
    onAddArtist: async ({ name }) => {
      try {
        await shell.saveBand?.(name);
      } catch {
        // Error surfaced via actionStatus
      }
      return renderCurrent();
    },
    onNavigate: async (view) => {
      await shell.navigate?.(view);
      return renderCurrent();
    },
    onNavigateSaved: async () => {
      await shell.navigate?.("saved-artists");
      return renderCurrent();
    },
    onNavigateSettings: async () => {
      if (router) router.navigate("settings");
      return renderCurrent();
    },
  };

  const settingsHandlers = {
    onNavigateChat: async () => {
      if (router) router.navigate("home");
      return renderCurrent();
    },
    onSaveApiKey: async (apiKey) => {
      await saveGeminiApiKey(apiKey);
      return renderCurrent();
    },
  };

  const savedHandlers = {
    onNavigate: (view) => {
      if (view === "chat" && router) router.navigate("home");
      renderCurrent();
    },
    onToggleSelection: (id) => {
      savedArtistsShell?.toggleArtistSelection(id);
      renderCurrent();
    },
    onSearch: async (query) => {
      savedArtistsShell?.setSearchQuery(query);
      await savedArtistsShell?.searchArtists();
      renderCurrent();
    },
    onAddArtist: (artist) => {
      Promise.resolve(savedArtistsShell?.addArtist(artist)).then(() => renderCurrent());
    },
    onDelete: async () => {
      renderCurrent();
    },
    onActivateStyleRef: async () => {},
  };

  if (router) {
    router.onRouteChange(() => renderCurrent());
  }

  return {
    handlers,
    mount() {
      return renderCurrent();
    },
  };
}

module.exports = {
  createDesktopReactMount,
};

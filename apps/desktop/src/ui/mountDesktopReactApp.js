const React = require("react");
const { createRoot } = require("react-dom/client");
const { ChatAppView } = require("./ChatAppView");
const { SavedArtistsView } = require("./SavedArtistsView");

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

function createDesktopReactMount({
  shell,
  createRootImpl = createRoot,
  resolveContainer = defaultContainerResolver,
}) {
  const container = resolveContainer();
  const root = createRootImpl(container);

  async function renderCurrent() {
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
        await shell.submitQuery(query);
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
    onNavigate: async (view) => {
      await shell.navigate?.(view);
      return renderCurrent();
    },
  };

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

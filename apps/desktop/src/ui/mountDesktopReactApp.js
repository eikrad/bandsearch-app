const React = require("react");
const { createRoot } = require("react-dom/client");
const { ChatAppView } = require("./ChatAppView");

function defaultContainerResolver() {
  /** @type {any} */ const browserDocument = globalThis.document;
  const root = browserDocument?.getElementById("root");
  if (!root) {
    throw new Error("missing root container");
  }
  return root;
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
    root.render(
      React.createElement(ChatAppView, {
        viewProps,
        handlers,
      }),
    );
    return viewProps;
  }

  const handlers = {
    onModeChange: async (mode) => {
      await shell.updateMode(mode);
      return renderCurrent();
    },
    onQuerySubmit: async (query) => {
      await shell.submitQuery(query);
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

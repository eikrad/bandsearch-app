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
      void artistName;
    },
    onRate: (artistName) => {
      void artistName;
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

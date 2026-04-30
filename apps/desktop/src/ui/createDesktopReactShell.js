const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { ChatAppView } = require("./ChatAppView");

function createDesktopReactShell({ renderAdapter, actionHandlers = {} }) {
  const resolvedActionHandlers = /** @type {any} */ (actionHandlers);
  const handlers = {
    onModeChange: (mode) => renderAdapter.onModeChange(mode),
    onQuerySubmit: (query) => renderAdapter.onSubmitQuery(query),
    onSave: resolvedActionHandlers.onSave || (() => {}),
    onRate: resolvedActionHandlers.onRate || (() => {}),
    onMore: resolvedActionHandlers.onMore || (() => {}),
  };

  return {
    getViewProps() {
      return renderAdapter.getViewProps();
    },
    async updateMode(mode) {
      return handlers.onModeChange(mode);
    },
    async submitQuery(query) {
      return handlers.onQuerySubmit(query);
    },
    renderHtml() {
      const viewProps = renderAdapter.getViewProps();
      return renderToStaticMarkup(React.createElement(ChatAppView, { viewProps, handlers }));
    },
  };
}

module.exports = {
  createDesktopReactShell,
};

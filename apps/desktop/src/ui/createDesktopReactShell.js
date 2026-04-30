const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { ChatAppView } = require("./ChatAppView");

function createDesktopReactShell({ renderAdapter, actionHandlers = {}, statusTimeoutMs = 3000, setTimeoutImpl = setTimeout }) {
  const resolvedActionHandlers = /** @type {any} */ (actionHandlers);
  let actionStatus = null;
  let clearStatusTimer = null;

  function scheduleStatusClear() {
    if (clearStatusTimer) {
      clearTimeout(clearStatusTimer);
    }
    clearStatusTimer = setTimeoutImpl(() => {
      actionStatus = null;
      clearStatusTimer = null;
    }, statusTimeoutMs);
  }
  const handlers = {
    onModeChange: (mode) => renderAdapter.onModeChange(mode),
    onQuerySubmit: (query) => renderAdapter.onSubmitQuery(query),
    onSave: resolvedActionHandlers.onSave || (() => {}),
    onRate: resolvedActionHandlers.onRate || (() => {}),
    onMore: resolvedActionHandlers.onMore || (() => {}),
  };

  return {
    getViewProps() {
      const base = renderAdapter.getViewProps();
      return {
        ...base,
        actionStatus,
      };
    },
    async updateMode(mode) {
      return handlers.onModeChange(mode);
    },
    async submitQuery(query) {
      return handlers.onQuerySubmit(query);
    },
    async saveBand(artistName) {
      try {
        const result = await handlers.onSave(artistName);
        actionStatus = { type: "success", message: `Saved ${artistName}.` };
        scheduleStatusClear();
        return result;
      } catch (error) {
        actionStatus = { type: "error", message: `Save failed for ${artistName}.` };
        scheduleStatusClear();
        throw error;
      }
    },
    async rateBand(artistName, rating = 5) {
      try {
        const result = await handlers.onRate(artistName, rating);
        actionStatus = { type: "success", message: `Rated ${artistName}: ${rating}/5.` };
        scheduleStatusClear();
        return result;
      } catch (error) {
        actionStatus = { type: "error", message: `Rating failed for ${artistName}.` };
        scheduleStatusClear();
        throw error;
      }
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

const { bootstrapDesktopApp, bootstrapDesktopReactApp } = require("./index");

/**
 * @param {{ apiBaseUrl?: string, fetchImpl?: any, viewport?: string, actionHandlers?: any }} [options]
 */
function startDesktopBrowserApp({
  apiBaseUrl = "http://localhost:3001",
  fetchImpl,
  viewport = "desktop",
  actionHandlers = {},
} = {}) {
  const app = bootstrapDesktopApp({ apiBaseUrl, fetchImpl });
  const reactApp = bootstrapDesktopReactApp({ app, viewport, actionHandlers });
  reactApp.mount();
  return reactApp;
}

module.exports = {
  startDesktopBrowserApp,
};

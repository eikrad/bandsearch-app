const { bootstrapDesktopApp, bootstrapDesktopReactApp } = require("./index");
const { createHashRouter } = require("./createHashRouter");
const { createSavedArtistsShell } = require("./createSavedArtistsShell");

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
  const router = createHashRouter();
  const savedArtistsShell = createSavedArtistsShell({ app });
  const reactApp = bootstrapDesktopReactApp({ app, viewport, actionHandlers, router, savedArtistsShell });
  reactApp.mount();
  return reactApp;
}

module.exports = {
  startDesktopBrowserApp,
};

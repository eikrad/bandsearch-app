const { bootstrapDesktopApp, bootstrapDesktopReactApp } = require("./index");
const { createHashRouter } = require("./createHashRouter");
const { createSavedArtistsShell } = require("./createSavedArtistsShell");
const { createGeminiSettingsController } = require("./geminiDesktopSettings");

function createDefaultTauriInvoke() {
  try {
    const { invoke } = require("@tauri-apps/api/core");
    return (/** @type {string} */ cmd, /** @type {Record<string, string>} */ args) => invoke(cmd, args);
  } catch {
    return undefined;
  }
}

/**
 * @param {{
 *   apiBaseUrl?: string,
 *   fetchImpl?: any,
 *   viewport?: string,
 *   actionHandlers?: any,
 *   invokeTauri?: (cmd: string, args?: Record<string, string>) => Promise<unknown>,
 * }} [options]
 */
function startDesktopBrowserApp({
  apiBaseUrl = "http://localhost:3001",
  fetchImpl,
  viewport = "desktop",
  actionHandlers = {},
  invokeTauri,
} = {}) {
  const resolvedInvoke =
    typeof invokeTauri === "function" ? invokeTauri : createDefaultTauriInvoke();
  const gemini = createGeminiSettingsController({
    invokeTauri: typeof resolvedInvoke === "function" ? resolvedInvoke : undefined,
  });
  const app = bootstrapDesktopApp({ apiBaseUrl, fetchImpl });
  const router = createHashRouter();
  const savedArtistsShell = createSavedArtistsShell({ app });
  const reactApp = bootstrapDesktopReactApp({
    app,
    viewport,
    actionHandlers,
    router,
    savedArtistsShell,
    getSettingsViewProps: () => gemini.getSettingsViewProps(),
    saveGeminiApiKey: (key) => gemini.saveGeminiApiKey(key),
  });
  reactApp.mount();
  return reactApp;
}

module.exports = {
  startDesktopBrowserApp,
};

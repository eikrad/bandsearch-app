const { bootstrapDesktopApp, bootstrapDesktopReactApp } = require("./index");
const { createHashRouter } = require("./createHashRouter");
const { createSavedArtistsShell } = require("./createSavedArtistsShell");
const { createGeminiSettingsController } = require("./geminiDesktopSettings");
const { shouldOfferWelcomeScreen } = require("./firstRunOnboarding.js");

/** Matches CSS layout switch: narrow window → mobile chat layout (split rail hides). */
const VIEWPORT_BREAKPOINT_MAX_PX = 767;

function browserWindow() {
  return typeof globalThis !== "undefined" ? globalThis.window : undefined;
}

function resolveInitialViewport(fallbackViewport) {
  const w = browserWindow();
  if (!w || typeof w.matchMedia !== "function") {
    return fallbackViewport;
  }
  return w.matchMedia(`(max-width: ${VIEWPORT_BREAKPOINT_MAX_PX}px)`).matches
    ? "mobile"
    : "desktop";
}

function subscribeViewportChanges(desktopUi, rerender) {
  const w = browserWindow();
  if (!w || typeof w.matchMedia !== "function") {
    return;
  }
  const mql = w.matchMedia(`(max-width: ${VIEWPORT_BREAKPOINT_MAX_PX}px)`);
  const onViewportChange = () => {
    desktopUi.setViewport(mql.matches ? "mobile" : "desktop");
    rerender();
  };
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onViewportChange);
  } else {
    mql.addListener(onViewportChange);
  }
}

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
async function startDesktopBrowserApp({
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
  const initialViewport = resolveInitialViewport(viewport);

  const w = browserWindow();
  const initialHash = w && typeof w.location?.hash === "string" ? w.location.hash : "";
  const gate = await gemini.getBootstrapGate();
  if (
    shouldOfferWelcomeScreen({
      hasStoredKey: gate.hasStoredKey,
      onboardingComplete: gate.onboardingComplete,
      locationHash: initialHash,
    })
  ) {
    router.navigate("welcome");
  }

  const reactApp = bootstrapDesktopReactApp({
    app,
    viewport: initialViewport,
    actionHandlers,
    router,
    savedArtistsShell,
    getSettingsViewProps: () => gemini.getSettingsViewProps(),
    saveGeminiApiKey: (key) => gemini.saveGeminiApiKey(key),
    saveBraveApiKey: (key) => gemini.saveBraveApiKey(key),
    completeOnboarding: () => gemini.completeOnboarding(),
  });
  await reactApp.mount();
  if (reactApp.desktopUi) {
    subscribeViewportChanges(reactApp.desktopUi, () => void reactApp.mount());
  }
  return reactApp;
}

module.exports = {
  startDesktopBrowserApp,
};

import { onLanguageChange } from "./i18n/i18n.js";
import { bootstrapDesktopApp, bootstrapDesktopReactApp } from "./index.js";
import { keepApiAwake } from "./keepApiAwake.js";
import { createHashRouter } from "./createHashRouter.js";
import { createSavedArtistsShell } from "./createSavedArtistsShell.js";
import { createDesktopSettingsController } from "./desktopSettings.js";
import { shouldOfferWelcomeScreen } from "./firstRunOnboarding.js";
import { getAuthToken, setAuthToken, clearAuthToken } from "./authTokenStore.js";
import { getChatSessionId, setChatSessionId } from "./chatSessionStore.js";
import { createAuthApiClient } from "./authApiClient.js";
import { createAppSession } from "./appSession.js";
import { createAuthAwareFetch } from "./authAwareFetch.js";
import {
  createUpdateNotificationController,
  type UpdateAvailablePayload,
  type UpdateDismissalStorage,
} from "./updateNotification.js";

const VIEWPORT_BREAKPOINT_MAX_PX = 767;

type ViewportController = { setViewport: (viewport: string) => void };

function browserWindow(): Window | undefined {
  return (globalThis as unknown as { window?: Window }).window;
}

function resolveInitialViewport(fallbackViewport: string): string {
  const w = browserWindow();
  if (!w || typeof w.matchMedia !== "function") return fallbackViewport;
  return w.matchMedia(`(max-width: ${VIEWPORT_BREAKPOINT_MAX_PX}px)`).matches ? "mobile" : "desktop";
}

type LegacyMQL = MediaQueryList & { addListener?: (cb: () => void) => void };

function subscribeViewportChanges(target: ViewportController, rerender: () => void): void {
  const w = browserWindow();
  if (!w || typeof w.matchMedia !== "function") return;
  const mql = w.matchMedia(`(max-width: ${VIEWPORT_BREAKPOINT_MAX_PX}px)`) as LegacyMQL;
  const onViewportChange = () => {
    target.setViewport(mql.matches ? "mobile" : "desktop");
    rerender();
  };
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onViewportChange);
  } else if (typeof mql.addListener === "function") {
    mql.addListener(onViewportChange);
  }
}

function createDefaultTauriInvoke(): ((cmd: string, args?: Record<string, string>) => Promise<unknown>) | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { invoke } = require("@tauri-apps/api/core") as { invoke: (cmd: string, args?: Record<string, string>) => Promise<unknown> };
    return (cmd: string, args?: Record<string, string>) => invoke(cmd, args);
  } catch {
    return undefined;
  }
}

/** Production default: subscribe to main.rs's `update-available` event. Absent (returns
 * undefined) outside a Tauri host, same fallback shape as createDefaultTauriInvoke. */
function createDefaultUpdateListener(): ((handler: (payload: UpdateAvailablePayload) => void) => void) | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { listen } = require("@tauri-apps/api/event") as {
      listen: (event: string, handler: (event: { payload: UpdateAvailablePayload }) => void) => Promise<unknown>;
    };
    return (handler: (payload: UpdateAvailablePayload) => void) => {
      // No Tauri host answering (browser dev, tests) rejects asynchronously;
      // there is nothing to subscribe to, so the rejection is not surfaced.
      listen("update-available", (event) => handler(event.payload)).catch(() => {});
    };
  } catch {
    return undefined;
  }
}

function createDefaultUpdateDismissalStorage(): UpdateDismissalStorage {
  return {
    getItem: (key: string) => {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem: (key: string, value: string) => {
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch {
        /* ignore */
      }
    },
  };
}

export type ActionHandlers = {
  onSave?: (artistName: string) => void;
  onRate?: (artistName: string, rating: number | null) => void;
};

/**
 * Bootstrapping collaborators. Production callers omit these and get the
 * implementations from `./index.js`; tests inject doubles instead of patching
 * the module loader.
 */
export type StartDesktopBrowserAppDeps = {
  bootstrapDesktopApp?: typeof bootstrapDesktopApp;
  bootstrapDesktopReactApp?: typeof bootstrapDesktopReactApp;
};

export type StartDesktopBrowserAppOptions = {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  viewport?: string;
  actionHandlers?: ActionHandlers;
  invokeTauri?: (cmd: string, args?: Record<string, string>) => Promise<unknown>;
  listenUpdateAvailable?: (handler: (payload: UpdateAvailablePayload) => void) => void;
  updateDismissalStorage?: UpdateDismissalStorage;
  /** Injected by tests so the API wait is driven rather than waited out. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  deps?: StartDesktopBrowserAppDeps;
};

export async function startDesktopBrowserApp({
  apiBaseUrl = "http://localhost:3001",
  fetchImpl,
  viewport = "desktop",
  actionHandlers = {},
  invokeTauri,
  listenUpdateAvailable,
  updateDismissalStorage,
  sleep,
  now,
  deps = {},
}: StartDesktopBrowserAppOptions = {}): Promise<ReturnType<typeof bootstrapDesktopReactApp>> {
  const {
    bootstrapDesktopApp: bootstrapApp = bootstrapDesktopApp,
    bootstrapDesktopReactApp: bootstrapReactApp = bootstrapDesktopReactApp,
  } = deps;
  const resolvedInvoke = typeof invokeTauri === "function" ? invokeTauri : createDefaultTauriInvoke();
  const resolvedListenUpdateAvailable = listenUpdateAvailable ?? createDefaultUpdateListener();
  const updateStorage = updateDismissalStorage ?? createDefaultUpdateDismissalStorage();
  const resolvedFetch = fetchImpl ?? fetch;
  const resolvedSleep = sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const resolvedNow = now ?? (() => Date.now());

  // Subscribed before any await below. The backend check is spawned from Rust's
  // .setup() and Tauri's emit has no replay buffer, so subscribing after the
  // bootstrap/auth round trips would silently drop an update that arrived
  // first. The controller buffers until the UI attaches after mount.
  const updateNotifications = createUpdateNotificationController({
    storage: updateStorage,
    installUpdate: async () => { await resolvedInvoke?.("install_update"); },
    onInstallError: (error) => {
      console.error("[bandsearch] update install failed", error);
    },
  });
  resolvedListenUpdateAvailable?.((payload) => updateNotifications.updateAvailable(payload));
  const router = createHashRouter();
  // A 401 can only arrive after the session below exists: nothing is fetched before it.
  const authAwareFetch = createAuthAwareFetch(resolvedFetch, () => session.unauthorized());

  const normalizeBase = (url: string): string => (url.endsWith("/") ? url.slice(0, -1) : url);
  // Resolved later from the stored config; the Turso probe reads it lazily so it
  // always targets the same API the rest of the app talks to.
  let resolvedBaseUrl = normalizeBase(apiBaseUrl);

  const settings = createDesktopSettingsController({
    invokeTauri: typeof resolvedInvoke === "function" ? resolvedInvoke : undefined,
    probeTursoConnection: async (url: string, token: string) => {
      try {
        const response = await authAwareFetch(`${resolvedBaseUrl}/preferences/turso/test`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ databaseUrl: url, authToken: token }),
        });
        return response.json() as Promise<{ ok: boolean; error?: string }>;
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "probe failed" };
      }
    },
  });

  // Read the persisted config before building API clients so a configured remote
  // endpoint becomes the base URL for every caller (chat, auth, preferences).
  const gate = await settings.getBootstrapGate();
  if (gate.apiEndpointUrl) resolvedBaseUrl = normalizeBase(gate.apiEndpointUrl);

  const authClient = createAuthApiClient({ apiBaseUrl: resolvedBaseUrl, fetchImpl: authAwareFetch });
  const session = createAppSession({
    auth: authClient,
    token: { get: getAuthToken, set: setAuthToken, clear: clearAuthToken },
    router,
    sleep: resolvedSleep,
    now: resolvedNow,
  });
  const app = bootstrapApp({
    apiBaseUrl: resolvedBaseUrl,
    fetchImpl: authAwareFetch,
    getToken: () => getAuthToken(),
    onSessionResolved: (sessionId) => setChatSessionId(sessionId),
  });
  // Only attempt a resume when a prior session was actually persisted — on a
  // first-ever launch (or in every test, which starts with no localStorage
  // entry) this is a pure local check and makes no network call at all.
  const persistedSessionId = getChatSessionId();
  if (persistedSessionId) await app.resumeSession(persistedSessionId);
  const savedArtistsShell = createSavedArtistsShell({ app });
  const initialViewport = resolveInitialViewport(viewport);

  const w = browserWindow();
  const initialHash = w && typeof w.location?.hash === "string" ? w.location.hash : "";

  await session.start({
    offerWelcome: shouldOfferWelcomeScreen({
      hasStoredKey: gate.hasStoredKey,
      onboardingComplete: gate.onboardingComplete,
      locationHash: initialHash,
    }),
  });

  const reactApp = bootstrapReactApp({
    app,
    viewport: initialViewport,
    actionHandlers,
    router,
    savedArtistsShell,
    getSettingsViewProps: async () => ({ ...(await settings.getSettingsViewProps()), accountsEnabled: session.accountsEnabled() }),
    onExportAccountData: async () => {
      const result = await authClient.exportAccountData();
      if (result.ok === false) throw new Error(result.error);
      return result.bundle;
    },
    onDeleteAccount: (password: string) => session.deleteAccount(password),
    saveLlmApiKey: (key: string) => settings.saveLlmApiKey(key),
    saveBraveApiKey: (key: string) => settings.saveBraveApiKey(key),
    saveTursoConfig: (url: string, token: string) => settings.saveTursoConfig(url, token),
    clearTursoConfig: () => settings.clearTursoConfig(),
    saveApiEndpointUrl: (url: string) => settings.saveApiEndpointUrl(url),
    completeOnboarding: () => settings.completeOnboarding(),
    enterApp: () => session.enterApp(),
    onLogin: (email: string, password: string) => session.login(email, password),
    onRegister: (email: string, displayName: string, password: string, inviteCode?: string) =>
      session.register(email, displayName, password, inviteCode),
    getRegisterViewProps: () => ({ inviteRequired: session.inviteRequired() }),
    onResetPassword: (email: string, recoveryCode: string, newPassword: string) =>
      session.resetPassword(email, recoveryCode, newPassword),
    updateBannerHandlers: updateNotifications.handlers,
    getConnectingViewProps: () => session.connectingViewProps(),
    connectingHandlers: { onRetry: () => { void session.retry(); } },
  });
  await reactApp.mount();
  subscribeViewportChanges(reactApp, () => void reactApp.mount());
  keepApiAwake({ apiBaseUrl: resolvedBaseUrl, fetchImpl: resolvedFetch, document: w?.document });

  // The UI can paint now; flushes an update that was reported during bootstrap.
  updateNotifications.attach((viewProps) => reactApp.showUpdateBanner(viewProps));

  // Connecting progress changes the screen without a navigation.
  session.subscribe(() => void reactApp.mount());
  // Views read their text while they render, so a new language is a new render (#329).
  onLanguageChange(() => void reactApp.mount());
  // Something is on screen now, so the remaining retries are visible rather than
  // spent behind a blank window.
  await session.connectIfWaiting();

  return reactApp;
}

import { bootstrapDesktopApp, bootstrapDesktopReactApp } from "./index.js";
import { createHashRouter } from "./createHashRouter.js";
import { createSavedArtistsShell } from "./createSavedArtistsShell.js";
import { createGeminiSettingsController } from "./geminiDesktopSettings.js";
import { shouldOfferWelcomeScreen } from "./firstRunOnboarding.js";
import { getAuthToken, setAuthToken, clearAuthToken } from "./authTokenStore.js";
import { createAuthApiClient, type LoginResult, type RegisterResult, type ResetPasswordResult } from "./authApiClient.js";
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

function subscribeViewportChanges(desktopUi: ViewportController, rerender: () => void): void {
  const w = browserWindow();
  if (!w || typeof w.matchMedia !== "function") return;
  const mql = w.matchMedia(`(max-width: ${VIEWPORT_BREAKPOINT_MAX_PX}px)`) as LegacyMQL;
  const onViewportChange = () => {
    desktopUi.setViewport(mql.matches ? "mobile" : "desktop");
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
  onRate?: (artistName: string) => void;
  onMore?: () => void;
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
  const authAwareFetch = createAuthAwareFetch(resolvedFetch, () => {
    clearAuthToken();
    router.navigate("login");
  });

  const normalizeBase = (url: string): string => (url.endsWith("/") ? url.slice(0, -1) : url);
  // Resolved later from the stored config; the Turso probe reads it lazily so it
  // always targets the same API the rest of the app talks to.
  let resolvedBaseUrl = normalizeBase(apiBaseUrl);

  const gemini = createGeminiSettingsController({
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
  const gate = await gemini.getBootstrapGate();
  if (gate.apiEndpointUrl) resolvedBaseUrl = normalizeBase(gate.apiEndpointUrl);

  const authClient = createAuthApiClient({ apiBaseUrl: resolvedBaseUrl, fetchImpl: authAwareFetch });
  const app = bootstrapApp({ apiBaseUrl: resolvedBaseUrl, fetchImpl: authAwareFetch, getToken: () => getAuthToken() });
  const savedArtistsShell = createSavedArtistsShell({ app });
  const initialViewport = resolveInitialViewport(viewport);

  const w = browserWindow();
  const initialHash = w && typeof w.location?.hash === "string" ? w.location.hash : "";

  async function runAuthGate(): Promise<void> {
    const authStatus = await authClient.getAuthStatus();
    if (!authStatus.enabled) return;
    if (authStatus.userCount === 0) {
      router.navigate("register");
    } else if (!getAuthToken()) {
      router.navigate("login");
    }
  }

  if (shouldOfferWelcomeScreen({ hasStoredKey: gate.hasStoredKey, onboardingComplete: gate.onboardingComplete, locationHash: initialHash })) {
    router.navigate("welcome");
  } else {
    await runAuthGate();
  }

  async function onLogin(email: string, password: string): Promise<void> {
    const result: LoginResult = await authClient.login({ email, password });
    if (result.ok === false) throw new Error(result.error);
    setAuthToken(result.token);
  }

  async function onRegister(email: string, displayName: string, password: string): Promise<{ recoveryCode: string }> {
    const result: RegisterResult = await authClient.register({ email, displayName, password });
    if (result.ok === false) throw new Error(result.error);
    setAuthToken(result.token);
    return { recoveryCode: result.recoveryCode };
  }

  async function onResetPassword(email: string, recoveryCode: string, newPassword: string): Promise<{ newRecoveryCode: string }> {
    const result: ResetPasswordResult = await authClient.resetPassword({ email, recoveryCode, newPassword });
    if (result.ok === false) throw new Error(result.error);
    clearAuthToken();
    return { newRecoveryCode: result.newRecoveryCode };
  }

  const reactApp = bootstrapReactApp({
    app,
    viewport: initialViewport,
    actionHandlers,
    router,
    savedArtistsShell,
    getSettingsViewProps: () => gemini.getSettingsViewProps(),
    saveGeminiApiKey: (key: string) => gemini.saveGeminiApiKey(key),
    saveBraveApiKey: (key: string) => gemini.saveBraveApiKey(key),
    saveTursoConfig: (url: string, token: string) => gemini.saveTursoConfig(url, token),
    clearTursoConfig: () => gemini.clearTursoConfig(),
    saveApiEndpointUrl: (url: string) => gemini.saveApiEndpointUrl(url),
    completeOnboarding: async () => { await gemini.completeOnboarding(); await runAuthGate(); },
    onLogin,
    onRegister,
    onResetPassword,
    updateBannerHandlers: updateNotifications.handlers,
  });
  await reactApp.mount();
  if (reactApp.desktopUi) {
    subscribeViewportChanges(reactApp.desktopUi, () => void reactApp.mount());
  }

  // The UI can paint now; flushes an update that was reported during bootstrap.
  updateNotifications.attach((viewProps) => reactApp.showUpdateBanner(viewProps));

  return reactApp;
}

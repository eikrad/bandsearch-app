import { bootstrapDesktopApp, bootstrapDesktopReactApp } from "./index.js";
import { createHashRouter } from "./createHashRouter.js";
import { createSavedArtistsShell } from "./createSavedArtistsShell.js";
import { createGeminiSettingsController } from "./geminiDesktopSettings.js";
import { shouldOfferWelcomeScreen } from "./firstRunOnboarding.js";
import { getAuthToken, setAuthToken, clearAuthToken } from "./authTokenStore.js";
import { createAuthApiClient, type LoginResult, type RegisterResult, type ResetPasswordResult } from "./authApiClient.js";

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

export type ActionHandlers = {
  onSave?: (artistName: string) => void;
  onRate?: (artistName: string) => void;
  onMore?: () => void;
};

export type StartDesktopBrowserAppOptions = {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  viewport?: string;
  actionHandlers?: ActionHandlers;
  invokeTauri?: (cmd: string, args?: Record<string, string>) => Promise<unknown>;
};

export async function startDesktopBrowserApp({
  apiBaseUrl = "http://localhost:3001",
  fetchImpl,
  viewport = "desktop",
  actionHandlers = {},
  invokeTauri,
}: StartDesktopBrowserAppOptions = {}) {
  const resolvedInvoke = typeof invokeTauri === "function" ? invokeTauri : createDefaultTauriInvoke();
  const resolvedFetch = fetchImpl ?? fetch;

  const gemini = createGeminiSettingsController({
    invokeTauri: typeof resolvedInvoke === "function" ? resolvedInvoke : undefined,
    probeTursoConnection: async (url: string, token: string) => {
      const base = apiBaseUrl.endsWith("/") ? apiBaseUrl.slice(0, -1) : apiBaseUrl;
      try {
        const response = await resolvedFetch(`${base}/preferences/turso/test`, {
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

  const authClient = createAuthApiClient({ apiBaseUrl, fetchImpl: resolvedFetch });
  const app = bootstrapDesktopApp({ apiBaseUrl, fetchImpl, getToken: () => getAuthToken() });
  const router = createHashRouter();
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

  const gate = await gemini.getBootstrapGate();
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

  const reactApp = bootstrapDesktopReactApp({
    app,
    viewport: initialViewport,
    actionHandlers,
    router,
    savedArtistsShell,
    getSettingsViewProps: () => gemini.getSettingsViewProps(),
    saveGeminiApiKey: (key: string) => gemini.saveGeminiApiKey(key),
    saveBraveApiKey: (key: string) => gemini.saveBraveApiKey(key),
    saveTursoConfig: (url: string, token: string) => gemini.saveTursoConfig(url, token),
    completeOnboarding: async () => { await gemini.completeOnboarding(); await runAuthGate(); },
    onLogin,
    onRegister,
    onResetPassword,
  });
  await reactApp.mount();
  if (reactApp.desktopUi) {
    subscribeViewportChanges(reactApp.desktopUi as ViewportController, () => void reactApp.mount());
  }
  return reactApp;
}

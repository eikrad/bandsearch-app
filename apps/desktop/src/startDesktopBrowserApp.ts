import { bootstrapDesktopApp, bootstrapDesktopReactApp } from "./index.js";
import { createHashRouter } from "./createHashRouter.js";
import { createSavedArtistsShell } from "./createSavedArtistsShell.js";
import { createGeminiSettingsController } from "./geminiDesktopSettings.js";
import { shouldOfferWelcomeScreen } from "./firstRunOnboarding.js";
import { getAuthToken, setAuthToken, clearAuthToken } from "./authTokenStore.js";
import { createAuthApiClient, type LoginResult, type RegisterResult, type ResetPasswordResult } from "./authApiClient.js";

const VIEWPORT_BREAKPOINT_MAX_PX = 767;

function browserWindow(): Window | undefined {
  return typeof globalThis !== "undefined" ? (globalThis as any).window : undefined;
}

function resolveInitialViewport(fallbackViewport: string): string {
  const w = browserWindow();
  if (!w || typeof w.matchMedia !== "function") return fallbackViewport;
  return w.matchMedia(`(max-width: ${VIEWPORT_BREAKPOINT_MAX_PX}px)`).matches ? "mobile" : "desktop";
}

function subscribeViewportChanges(desktopUi: any, rerender: () => void): void {
  const w = browserWindow();
  if (!w || typeof w.matchMedia !== "function") return;
  const mql = w.matchMedia(`(max-width: ${VIEWPORT_BREAKPOINT_MAX_PX}px)`);
  const onViewportChange = () => {
    desktopUi.setViewport(mql.matches ? "mobile" : "desktop");
    rerender();
  };
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onViewportChange);
  } else {
    (mql as any).addListener(onViewportChange);
  }
}

function createDefaultTauriInvoke(): ((cmd: string, args?: Record<string, string>) => Promise<unknown>) | undefined {
  try {
    const { invoke } = require("@tauri-apps/api/core");
    return (cmd: string, args?: Record<string, string>) => invoke(cmd, args);
  } catch {
    return undefined;
  }
}

export type StartDesktopBrowserAppOptions = {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  viewport?: string;
  actionHandlers?: any;
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
        return response.json();
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
  const gate = await (gemini as any).getBootstrapGate();
  if (shouldOfferWelcomeScreen({ hasStoredKey: gate.hasStoredKey, onboardingComplete: gate.onboardingComplete, locationHash: initialHash })) {
    router.navigate("welcome");
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
    getSettingsViewProps: () => (gemini as any).getSettingsViewProps(),
    saveGeminiApiKey: (key: string) => (gemini as any).saveGeminiApiKey(key),
    saveBraveApiKey: (key: string) => (gemini as any).saveBraveApiKey(key),
    saveTursoConfig: (url: string, token: string) => (gemini as any).saveTursoConfig(url, token),
    completeOnboarding: () => (gemini as any).completeOnboarding(),
    onLogin,
    onRegister,
    onResetPassword,
  });
  await reactApp.mount();
  if (reactApp.desktopUi) {
    subscribeViewportChanges(reactApp.desktopUi, () => void reactApp.mount());
  }
  return reactApp;
}

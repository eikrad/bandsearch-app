import { FIRST_RUN_ONBOARDING_STORAGE_KEY } from "./firstRunOnboarding.js";

export const API_ENDPOINT_STORAGE_KEY = "bandsearch_api_endpoint_url";

type StatusMessage = { type: "success" | "error"; text: string };
type ProbeResult = { ok: boolean; error?: string };

/** True for a non-empty http(s) URL. Empty is handled separately (= reset to local). */
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function defaultProbeTursoConnection(url: string, token: string): Promise<ProbeResult> {
  try {
    const response = await fetch("http://localhost:3001/preferences/turso/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ databaseUrl: url, authToken: token }),
    });
    if (!response.ok) return { ok: false, error: `probe request failed: ${response.status}` };
    return response.json() as Promise<ProbeResult>;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "probe request failed" };
  }
}

export interface GeminiSettingsControllerOptions {
  invokeTauri?: (cmd: string, args?: Record<string, string>) => Promise<unknown>;
  probeTursoConnection?: (url: string, token: string) => Promise<ProbeResult>;
}

export function createGeminiSettingsController(options: GeminiSettingsControllerOptions = {}) {
  const { invokeTauri, probeTursoConnection } = options;
  let geminiStatus: StatusMessage | null = null;
  let braveStatus: StatusMessage | null = null;
  let tursoStatus: StatusMessage | null = null;
  let apiEndpointStatus: StatusMessage | null = null;

  async function getBootstrapGate() {
    if (typeof invokeTauri === "function") {
      try {
        const r = (await invokeTauri("gemini_config_status")) as {
          hasStoredKey?: boolean;
          onboardingComplete?: boolean;
          apiEndpointUrl?: string;
        };
        return {
          hasStoredKey: Boolean(r?.hasStoredKey),
          onboardingComplete: Boolean(r?.onboardingComplete),
          apiEndpointUrl: String(r?.apiEndpointUrl ?? "").trim(),
        };
      } catch {
        return { hasStoredKey: false, onboardingComplete: false, apiEndpointUrl: "" };
      }
    }
    try {
      const ls = globalThis.localStorage;
      if (!ls) return { hasStoredKey: false, onboardingComplete: false, apiEndpointUrl: "" };
      return {
        hasStoredKey: Boolean(ls.getItem("bandsearch_gemini_api_key")?.trim()),
        onboardingComplete: ls.getItem(FIRST_RUN_ONBOARDING_STORAGE_KEY) === "1",
        apiEndpointUrl: String(ls.getItem(API_ENDPOINT_STORAGE_KEY) ?? "").trim(),
      };
    } catch {
      return { hasStoredKey: false, onboardingComplete: false, apiEndpointUrl: "" };
    }
  }

  async function completeOnboarding() {
    if (typeof invokeTauri === "function") {
      try {
        await invokeTauri("complete_onboarding");
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      globalThis.localStorage?.setItem(FIRST_RUN_ONBOARDING_STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  async function getSettingsViewProps() {
    let hasStoredKey = false;
    let hasBraveKey = false;
    let hasTursoConfig = false;
    let geminiKeyFromEnv = false;
    let braveKeyFromEnv = false;
    let tursoFromEnv = false;
    let apiEndpointUrl = "";

    if (typeof invokeTauri === "function") {
      try {
        const r = (await invokeTauri("gemini_config_status")) as {
          hasStoredKey?: boolean;
          hasBraveKey?: boolean;
          hasTursoConfig?: boolean;
          geminiKeyFromEnv?: boolean;
          braveKeyFromEnv?: boolean;
          tursoFromEnv?: boolean;
          apiEndpointUrl?: string;
        };
        hasStoredKey = Boolean(r?.hasStoredKey);
        hasBraveKey = Boolean(r?.hasBraveKey);
        hasTursoConfig = Boolean(r?.hasTursoConfig);
        geminiKeyFromEnv = Boolean(r?.geminiKeyFromEnv);
        braveKeyFromEnv = Boolean(r?.braveKeyFromEnv);
        tursoFromEnv = Boolean(r?.tursoFromEnv);
        apiEndpointUrl = String(r?.apiEndpointUrl ?? "").trim();
      } catch {
        /* defaults */
      }
    } else {
      try {
        const ls = globalThis.localStorage;
        if (ls) {
          hasStoredKey = Boolean(ls.getItem("bandsearch_gemini_api_key")?.trim());
          hasBraveKey = Boolean(ls.getItem("bandsearch_brave_api_key")?.trim());
          hasTursoConfig = Boolean(ls.getItem("bandsearch_turso_database_url")?.trim());
          apiEndpointUrl = String(ls.getItem(API_ENDPOINT_STORAGE_KEY) ?? "").trim();
        }
      } catch {
        /* defaults */
      }
    }

    return {
      headerTitle: "Settings",
      headerSubtitle: "",
      hasStoredKey,
      hasBraveKey,
      hasTursoConfig,
      geminiKeyFromEnv,
      braveKeyFromEnv,
      tursoFromEnv,
      apiEndpointUrl,
      statusMessage: geminiStatus ?? braveStatus,
      geminiStatusMessage: geminiStatus,
      braveStatusMessage: braveStatus,
      tursoStatusMessage: tursoStatus,
      apiEndpointStatusMessage: apiEndpointStatus,
    };
  }

  async function saveGeminiApiKey(apiKey: string) {
    const trimmed = String(apiKey || "").trim();
    if (!trimmed) {
      geminiStatus = { type: "error", text: "Enter a non-empty API key." };
      return;
    }

    if (typeof invokeTauri === "function") {
      try {
        await invokeTauri("save_gemini_api_key", { apiKey: trimmed });
        geminiStatus = {
          type: "success",
          text: "Saved. The API process was restarted with your key.",
        };
      } catch (e) {
        const err = e as { message?: string };
        geminiStatus = { type: "error", text: String(err?.message || e || "Could not save key.") };
      }
      return;
    }

    try {
      globalThis.localStorage?.setItem("bandsearch_gemini_api_key", trimmed);
      globalThis.localStorage?.setItem(FIRST_RUN_ONBOARDING_STORAGE_KEY, "1");
      geminiStatus = {
        type: "success",
        text: "Stored in browser storage (development only). Use a .env file or the desktop app for production.",
      };
    } catch (e) {
      const err = e as { message?: string };
      geminiStatus = { type: "error", text: String(err?.message || e || "Could not save key.") };
    }
  }

  async function saveBraveApiKey(apiKey: string) {
    const trimmed = String(apiKey || "").trim();
    if (!trimmed) {
      braveStatus = { type: "error", text: "Enter a non-empty Brave API key." };
      return;
    }

    if (typeof invokeTauri === "function") {
      try {
        await invokeTauri("save_brave_api_key", { apiKey: trimmed });
        braveStatus = {
          type: "success",
          text: "Saved. The API process was restarted with your Brave key.",
        };
      } catch (e) {
        const err = e as { message?: string };
        braveStatus = { type: "error", text: String(err?.message || e || "Could not save key.") };
      }
      return;
    }

    try {
      globalThis.localStorage?.setItem("bandsearch_brave_api_key", trimmed);
      braveStatus = {
        type: "success",
        text: "Stored in browser storage (development only). Use a .env file or the desktop app for production.",
      };
    } catch (e) {
      const err = e as { message?: string };
      braveStatus = { type: "error", text: String(err?.message || e || "Could not save key.") };
    }
  }

  async function saveTursoConfig(databaseUrl: string, authToken: string) {
    const url = String(databaseUrl || "").trim();
    const token = String(authToken || "").trim();
    if (!url) {
      tursoStatus = { type: "error", text: "Enter a non-empty database URL." };
      return;
    }

    const probe = probeTursoConnection ?? defaultProbeTursoConnection;
    const probeResult = await probe(url, token);
    if (!probeResult.ok) {
      tursoStatus = { type: "error", text: probeResult.error || "Connection failed." };
      return;
    }

    if (typeof invokeTauri === "function") {
      try {
        await invokeTauri("save_turso_config", { databaseUrl: url, authToken: token });
        tursoStatus = { type: "success", text: "Saved. Syncing via Turso from next restart." };
      } catch (e) {
        const err = e as { message?: string };
        tursoStatus = {
          type: "error",
          text: String(err?.message || e || "Could not save config."),
        };
      }
      return;
    }

    try {
      globalThis.localStorage?.setItem("bandsearch_turso_database_url", url);
      globalThis.localStorage?.setItem("bandsearch_turso_auth_token", token);
      tursoStatus = { type: "success", text: "Stored in browser storage (development only)." };
    } catch (e) {
      const err = e as { message?: string };
      tursoStatus = {
        type: "error",
        text: String(err?.message || e || "Could not save config."),
      };
    }
  }

  async function saveApiEndpointUrl(endpointUrl: string) {
    const trimmed = String(endpointUrl || "").trim();
    // A blank value resets to the local sidecar; any non-blank value must be a URL.
    if (trimmed && !isHttpUrl(trimmed)) {
      apiEndpointStatus = {
        type: "error",
        text: "Enter a valid http(s) URL, or leave blank to use the built-in local app.",
      };
      return;
    }

    const successText = trimmed
      ? "Saved. The app will use the remote API from the next restart."
      : "Reset. The app will use the built-in local API from the next restart.";

    if (typeof invokeTauri === "function") {
      try {
        await invokeTauri("save_api_endpoint_url", { url: trimmed });
        apiEndpointStatus = { type: "success", text: successText };
      } catch (e) {
        const err = e as { message?: string };
        apiEndpointStatus = { type: "error", text: String(err?.message || e || "Could not save endpoint.") };
      }
      return;
    }

    try {
      const ls = globalThis.localStorage;
      if (trimmed) ls?.setItem(API_ENDPOINT_STORAGE_KEY, trimmed);
      else ls?.removeItem(API_ENDPOINT_STORAGE_KEY);
      apiEndpointStatus = { type: "success", text: successText };
    } catch (e) {
      const err = e as { message?: string };
      apiEndpointStatus = { type: "error", text: String(err?.message || e || "Could not save endpoint.") };
    }
  }

  async function clearTursoConfig() {
    if (typeof invokeTauri === "function") {
      try {
        await invokeTauri("clear_turso_config");
        tursoStatus = { type: "success", text: "Switched to local SQLite." };
      } catch (e) {
        const err = e as { message?: string };
        tursoStatus = { type: "error", text: String(err?.message || e || "Could not clear config.") };
      }
    }
  }

  return {
    getSettingsViewProps,
    saveGeminiApiKey,
    saveBraveApiKey,
    saveTursoConfig,
    clearTursoConfig,
    saveApiEndpointUrl,
    getBootstrapGate,
    completeOnboarding,
  };
}

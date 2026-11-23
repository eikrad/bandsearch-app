import { t } from "./i18n/i18n.js";
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

export interface DesktopSettingsControllerOptions {
  invokeTauri?: (cmd: string, args?: Record<string, string>) => Promise<unknown>;
  probeTursoConnection?: (url: string, token: string) => Promise<ProbeResult>;
}

export function createDesktopSettingsController(options: DesktopSettingsControllerOptions = {}) {
  const { invokeTauri, probeTursoConnection } = options;
  let llmStatus: StatusMessage | null = null;
  let braveStatus: StatusMessage | null = null;
  let tursoStatus: StatusMessage | null = null;
  let apiEndpointStatus: StatusMessage | null = null;

  async function readStatus() {
    if (typeof invokeTauri === "function") {
      try {
        return (await invokeTauri("llm_config_status")) as {
          hasStoredKey?: boolean;
          hasBraveKey?: boolean;
          hasTursoConfig?: boolean;
          llmKeyFromEnv?: boolean;
          braveKeyFromEnv?: boolean;
          tursoFromEnv?: boolean;
          onboardingComplete?: boolean;
          apiEndpointUrl?: string;
        };
      } catch {
        // A failed invoke means there is no Tauri host answering — the browser
        // build bundles @tauri-apps/api, so the import succeeds even in a plain
        // browser and only the IPC call fails. Returning `null` (not `{}`) is
        // what routes callers to their localStorage fallback; `{}` reads as
        // "Tauri answered, nothing configured" and stranded browser dev on the
        // welcome screen no matter what was stored.
        return null;
      }
    }
    return null;
  }

  async function getBootstrapGate() {
    const r = await readStatus();
    if (r !== null) {
      return {
        hasStoredKey: Boolean(r?.hasStoredKey),
        onboardingComplete: Boolean(r?.onboardingComplete),
        apiEndpointUrl: String(r?.apiEndpointUrl ?? "").trim(),
      };
    }
    try {
      const ls = globalThis.localStorage;
      if (!ls) return { hasStoredKey: false, onboardingComplete: false, apiEndpointUrl: "" };
      return {
        hasStoredKey: Boolean(ls.getItem("bandsearch_llm_api_key")?.trim()),
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
    let llmKeyFromEnv = false;
    let braveKeyFromEnv = false;
    let tursoFromEnv = false;
    let apiEndpointUrl = "";

    const r = await readStatus();
    if (r !== null) {
      hasStoredKey = Boolean(r?.hasStoredKey);
      hasBraveKey = Boolean(r?.hasBraveKey);
      hasTursoConfig = Boolean(r?.hasTursoConfig);
      llmKeyFromEnv = Boolean(r?.llmKeyFromEnv);
      braveKeyFromEnv = Boolean(r?.braveKeyFromEnv);
      tursoFromEnv = Boolean(r?.tursoFromEnv);
      apiEndpointUrl = String(r?.apiEndpointUrl ?? "").trim();
    } else {
      try {
        const ls = globalThis.localStorage;
        if (ls) {
          hasStoredKey = Boolean(ls.getItem("bandsearch_llm_api_key")?.trim());
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
      llmKeyFromEnv,
      braveKeyFromEnv,
      tursoFromEnv,
      apiEndpointUrl,
      statusMessage: llmStatus ?? braveStatus,
      llmStatusMessage: llmStatus,
      braveStatusMessage: braveStatus,
      tursoStatusMessage: tursoStatus,
      apiEndpointStatusMessage: apiEndpointStatus,
    };
  }

  async function saveLlmApiKey(apiKey: string) {
    const trimmed = String(apiKey || "").trim();
    if (!trimmed) {
      llmStatus = { type: "error", text: t("settings.status.keyEmpty") };
      return;
    }

    if (typeof invokeTauri === "function") {
      try {
        await invokeTauri("save_llm_api_key", { apiKey: trimmed });
        llmStatus = {
          type: "success",
          text: t("settings.status.keySaved"),
        };
      } catch (e) {
        const err = e as { message?: string };
        llmStatus = { type: "error", text: String(err?.message || e || t("settings.status.keyFailed")) };
      }
      return;
    }

    try {
      globalThis.localStorage?.setItem("bandsearch_llm_api_key", trimmed);
      globalThis.localStorage?.setItem(FIRST_RUN_ONBOARDING_STORAGE_KEY, "1");
      llmStatus = {
        type: "success",
        text: t("settings.status.keyStoredInBrowser"),
      };
    } catch (e) {
      const err = e as { message?: string };
      llmStatus = { type: "error", text: String(err?.message || e || t("settings.status.keyFailed")) };
    }
  }

  async function saveBraveApiKey(apiKey: string) {
    const trimmed = String(apiKey || "").trim();
    if (!trimmed) {
      braveStatus = { type: "error", text: t("settings.status.braveKeyEmpty") };
      return;
    }

    if (typeof invokeTauri === "function") {
      try {
        await invokeTauri("save_brave_api_key", { apiKey: trimmed });
        braveStatus = {
          type: "success",
          text: t("settings.status.braveKeySaved"),
        };
      } catch (e) {
        const err = e as { message?: string };
        braveStatus = { type: "error", text: String(err?.message || e || t("settings.status.keyFailed")) };
      }
      return;
    }

    try {
      globalThis.localStorage?.setItem("bandsearch_brave_api_key", trimmed);
      braveStatus = {
        type: "success",
        text: t("settings.status.keyStoredInBrowser"),
      };
    } catch (e) {
      const err = e as { message?: string };
      braveStatus = { type: "error", text: String(err?.message || e || t("settings.status.keyFailed")) };
    }
  }

  async function saveTursoConfig(databaseUrl: string, authToken: string) {
    const url = String(databaseUrl || "").trim();
    const token = String(authToken || "").trim();
    if (!url) {
      tursoStatus = { type: "error", text: t("settings.status.tursoUrlEmpty") };
      return;
    }

    const probe = probeTursoConnection ?? defaultProbeTursoConnection;
    const probeResult = await probe(url, token);
    if (!probeResult.ok) {
      tursoStatus = { type: "error", text: probeResult.error || t("settings.status.tursoConnectionFailed") };
      return;
    }

    if (typeof invokeTauri === "function") {
      try {
        await invokeTauri("save_turso_config", { databaseUrl: url, authToken: token });
        tursoStatus = { type: "success", text: t("settings.status.tursoSaved") };
      } catch (e) {
        const err = e as { message?: string };
        tursoStatus = {
          type: "error",
          text: String(err?.message || e || t("settings.status.tursoFailed")),
        };
      }
      return;
    }

    try {
      globalThis.localStorage?.setItem("bandsearch_turso_database_url", url);
      globalThis.localStorage?.setItem("bandsearch_turso_auth_token", token);
      tursoStatus = { type: "success", text: t("settings.status.tursoStoredInBrowser") };
    } catch (e) {
      const err = e as { message?: string };
      tursoStatus = {
        type: "error",
        text: String(err?.message || e || t("settings.status.tursoFailed")),
      };
    }
  }

  async function saveApiEndpointUrl(endpointUrl: string) {
    const trimmed = String(endpointUrl || "").trim();
    // A blank value resets to the local sidecar; any non-blank value must be a URL.
    if (trimmed && !isHttpUrl(trimmed)) {
      apiEndpointStatus = {
        type: "error",
        text: t("settings.status.endpointInvalid"),
      };
      return;
    }

    const successText = trimmed
      ? t("settings.status.endpointSaved")
      : t("settings.status.endpointReset");

    if (typeof invokeTauri === "function") {
      try {
        await invokeTauri("save_api_endpoint_url", { url: trimmed });
        apiEndpointStatus = { type: "success", text: successText };
      } catch (e) {
        const err = e as { message?: string };
        apiEndpointStatus = { type: "error", text: String(err?.message || e || t("settings.status.endpointFailed")) };
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
      apiEndpointStatus = { type: "error", text: String(err?.message || e || t("settings.status.endpointFailed")) };
    }
  }

  async function clearTursoConfig() {
    if (typeof invokeTauri === "function") {
      try {
        await invokeTauri("clear_turso_config");
        tursoStatus = { type: "success", text: t("settings.status.tursoCleared") };
      } catch (e) {
        const err = e as { message?: string };
        tursoStatus = { type: "error", text: String(err?.message || e || t("settings.status.tursoClearFailed")) };
      }
    }
  }

  return {
    getSettingsViewProps,
    saveLlmApiKey,
    saveBraveApiKey,
    saveTursoConfig,
    clearTursoConfig,
    saveApiEndpointUrl,
    getBootstrapGate,
    completeOnboarding,
  };
}

const { FIRST_RUN_ONBOARDING_STORAGE_KEY } = require("./firstRunOnboarding.js");

async function defaultProbeTursoConnection(url, token) {
  try {
    const response = await fetch("http://localhost:3001/preferences/turso/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ databaseUrl: url, authToken: token }),
    });
    if (!response.ok) return { ok: false, error: `probe request failed: ${response.status}` };
    const data = /** @type {any} */ (await response.json());
    return data;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "probe request failed" };
  }
}

/**
 * Desktop API key UI state: Tauri IPC when available, otherwise optional browser localStorage for dev.
 *
 * @param {{
 *   invokeTauri?: (cmd: string, args?: Record<string, string>) => Promise<unknown>,
 *   probeTursoConnection?: (url: string, token: string) => Promise<{ ok: boolean; error?: string }>,
 * }} [options]
 */
function createGeminiSettingsController(options = {}) {
  const { invokeTauri, probeTursoConnection } = options;
  let geminiStatus = /** @type {{ type: "success" | "error"; text: string } | null} */ (null);
  let braveStatus = /** @type {{ type: "success" | "error"; text: string } | null} */ (null);
  let tursoStatus = /** @type {{ type: "success" | "error"; text: string } | null} */ (null);

  async function getBootstrapGate() {
    if (typeof invokeTauri === "function") {
      try {
        const r = /** @type {{ hasStoredKey?: boolean; onboardingComplete?: boolean }} */ (
          await invokeTauri("gemini_config_status")
        );
        return {
          hasStoredKey: Boolean(r?.hasStoredKey),
          onboardingComplete: Boolean(r?.onboardingComplete),
        };
      } catch {
        return { hasStoredKey: false, onboardingComplete: false };
      }
    }
    try {
      const ls = globalThis.localStorage;
      if (!ls) return { hasStoredKey: false, onboardingComplete: false };
      return {
        hasStoredKey: Boolean(ls.getItem("bandsearch_gemini_api_key")?.trim()),
        onboardingComplete: ls.getItem(FIRST_RUN_ONBOARDING_STORAGE_KEY) === "1",
      };
    } catch {
      return { hasStoredKey: false, onboardingComplete: false };
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

    if (typeof invokeTauri === "function") {
      try {
        const r = /** @type {{ hasStoredKey?: boolean; hasBraveKey?: boolean; hasTursoConfig?: boolean }} */ (
          await invokeTauri("gemini_config_status")
        );
        hasStoredKey = Boolean(r?.hasStoredKey);
        hasBraveKey = Boolean(r?.hasBraveKey);
        hasTursoConfig = Boolean(r?.hasTursoConfig);
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
      statusMessage: geminiStatus ?? braveStatus,
      geminiStatusMessage: geminiStatus,
      braveStatusMessage: braveStatus,
      tursoStatusMessage: tursoStatus,
    };
  }

  async function saveGeminiApiKey(apiKey) {
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
        const err = /** @type {{ message?: string }} */ (e);
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
      const err = /** @type {{ message?: string }} */ (e);
      geminiStatus = { type: "error", text: String(err?.message || e || "Could not save key.") };
    }
  }

  async function saveBraveApiKey(apiKey) {
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
        const err = /** @type {{ message?: string }} */ (e);
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
      const err = /** @type {{ message?: string }} */ (e);
      braveStatus = { type: "error", text: String(err?.message || e || "Could not save key.") };
    }
  }

  async function saveTursoConfig(databaseUrl, authToken) {
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
        const err = /** @type {{ message?: string }} */ (e);
        tursoStatus = { type: "error", text: String(err?.message || e || "Could not save config.") };
      }
      return;
    }

    try {
      globalThis.localStorage?.setItem("bandsearch_turso_database_url", url);
      globalThis.localStorage?.setItem("bandsearch_turso_auth_token", token);
      tursoStatus = { type: "success", text: "Stored in browser storage (development only)." };
    } catch (e) {
      const err = /** @type {{ message?: string }} */ (e);
      tursoStatus = { type: "error", text: String(err?.message || e || "Could not save config.") };
    }
  }

  return { getSettingsViewProps, saveGeminiApiKey, saveBraveApiKey, saveTursoConfig, getBootstrapGate, completeOnboarding };
}

module.exports = {
  createGeminiSettingsController,
};

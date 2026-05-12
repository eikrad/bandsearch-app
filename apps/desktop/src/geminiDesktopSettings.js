const { FIRST_RUN_ONBOARDING_STORAGE_KEY } = require("./firstRunOnboarding.js");

/**
 * Desktop Gemini API key UI state: Tauri IPC when available, otherwise optional browser localStorage for dev.
 *
 * @param {{ invokeTauri?: (cmd: string, args?: Record<string, string>) => Promise<unknown> }} [options]
 */
function createGeminiSettingsController(options = {}) {
  const { invokeTauri } = options;
  let lastStatus = /** @type {{ type: "success" | "error"; text: string } | null} */ (null);

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
    const gate = await getBootstrapGate();
    return {
      headerTitle: "Settings",
      headerSubtitle: "",
      hasStoredKey: gate.hasStoredKey,
      statusMessage: lastStatus,
    };
  }

  async function saveGeminiApiKey(apiKey) {
    const trimmed = String(apiKey || "").trim();
    if (!trimmed) {
      lastStatus = { type: "error", text: "Enter a non-empty API key." };
      return;
    }

    if (typeof invokeTauri === "function") {
      try {
        await invokeTauri("save_gemini_api_key", { apiKey: trimmed });
        lastStatus = {
          type: "success",
          text: "Saved. The API process was restarted with your key.",
        };
      } catch (e) {
        const err = /** @type {{ message?: string }} */ (e);
        lastStatus = { type: "error", text: String(err?.message || e || "Could not save key.") };
      }
      return;
    }

    try {
      globalThis.localStorage?.setItem("bandsearch_gemini_api_key", trimmed);
      globalThis.localStorage?.setItem(FIRST_RUN_ONBOARDING_STORAGE_KEY, "1");
      lastStatus = {
        type: "success",
        text: "Stored in browser storage (development only). Use a .env file or the desktop app for production.",
      };
    } catch (e) {
      const err = /** @type {{ message?: string }} */ (e);
      lastStatus = { type: "error", text: String(err?.message || e || "Could not save key.") };
    }
  }

  return { getSettingsViewProps, saveGeminiApiKey, getBootstrapGate, completeOnboarding };
}

module.exports = {
  createGeminiSettingsController,
};

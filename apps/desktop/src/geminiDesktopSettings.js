const { FIRST_RUN_ONBOARDING_STORAGE_KEY } = require("./firstRunOnboarding.js");

/**
 * Desktop API key UI state: Tauri IPC when available, otherwise optional browser localStorage for dev.
 *
 * @param {{ invokeTauri?: (cmd: string, args?: Record<string, string>) => Promise<unknown> }} [options]
 */
function createGeminiSettingsController(options = {}) {
  const { invokeTauri } = options;
  let geminiStatus = /** @type {{ type: "success" | "error"; text: string } | null} */ (null);
  let braveStatus = /** @type {{ type: "success" | "error"; text: string } | null} */ (null);

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

    if (typeof invokeTauri === "function") {
      try {
        const r = /** @type {{ hasStoredKey?: boolean; hasBraveKey?: boolean }} */ (
          await invokeTauri("gemini_config_status")
        );
        hasStoredKey = Boolean(r?.hasStoredKey);
        hasBraveKey = Boolean(r?.hasBraveKey);
      } catch {
        /* defaults */
      }
    } else {
      try {
        const ls = globalThis.localStorage;
        if (ls) {
          hasStoredKey = Boolean(ls.getItem("bandsearch_gemini_api_key")?.trim());
          hasBraveKey = Boolean(ls.getItem("bandsearch_brave_api_key")?.trim());
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
      statusMessage: geminiStatus ?? braveStatus,
      geminiStatusMessage: geminiStatus,
      braveStatusMessage: braveStatus,
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

  return { getSettingsViewProps, saveGeminiApiKey, saveBraveApiKey, getBootstrapGate, completeOnboarding };
}

module.exports = {
  createGeminiSettingsController,
};

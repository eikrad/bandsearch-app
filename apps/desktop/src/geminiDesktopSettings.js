/**
 * Desktop Gemini API key UI state: Tauri IPC when available, otherwise optional browser localStorage for dev.
 *
 * @param {{ invokeTauri?: (cmd: string, args?: Record<string, string>) => Promise<unknown> }} [options]
 */
function createGeminiSettingsController(options = {}) {
  const { invokeTauri } = options;
  let lastStatus = /** @type {{ type: "success" | "error"; text: string } | null} */ (null);

  async function getSettingsViewProps() {
    let hasStoredKey = false;
    if (typeof invokeTauri === "function") {
      try {
        const r = /** @type {{ hasStoredKey?: boolean }} */ (await invokeTauri("gemini_config_status"));
        hasStoredKey = Boolean(r?.hasStoredKey);
      } catch {
        hasStoredKey = false;
      }
    } else {
      try {
        hasStoredKey = Boolean(globalThis.localStorage?.getItem("bandsearch_gemini_api_key")?.trim());
      } catch {
        hasStoredKey = false;
      }
    }

    return {
      headerTitle: "Settings",
      headerSubtitle: "",
      hasStoredKey,
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
      lastStatus = {
        type: "success",
        text: "Stored in browser storage (development only). Use a .env file or the desktop app for production.",
      };
    } catch (e) {
      const err = /** @type {{ message?: string }} */ (e);
      lastStatus = { type: "error", text: String(err?.message || e || "Could not save key.") };
    }
  }

  return { getSettingsViewProps, saveGeminiApiKey };
}

module.exports = {
  createGeminiSettingsController,
};

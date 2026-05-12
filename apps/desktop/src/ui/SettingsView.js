const React = require("react");

const palette = {
  pageBg: "#0d0f14",
  cardBg: "#111827",
  border: "#1e2a3a",
  textPrimary: "#f0f4f8",
  textSecondary: "#8896a8",
  textTertiary: "#5a6880",
  accent: "#7aa7d9",
  buttonBg: "#161e2e",
  buttonBorder: "#243044",
  buttonText: "#c8d4e8",
  inputBg: "#0b0e18",
  warnBg: "#2a1810",
  warnBorder: "#5c3d28",
};

function SettingsView({ viewProps, handlers }) {
  const [keyDraft, setKeyDraft] = React.useState("");
  const subtitle =
    viewProps.headerSubtitle ||
    "Your key is stored locally on this device and passed to the Bandsearch API process.";
  const banner =
    viewProps.hasStoredKey === false
      ? React.createElement(
          "div",
          {
            role: "status",
            style: {
              marginBottom: "16px",
              padding: "10px 12px",
              borderRadius: "8px",
              border: `1px solid ${palette.warnBorder}`,
              backgroundColor: palette.warnBg,
              color: palette.textSecondary,
              fontSize: "13px",
              lineHeight: 1.45,
            },
          },
          "No Gemini API key is configured yet. Add a key below so recommendations can run — or set GEMINI_API_KEY in a .env file for development.",
        )
      : null;

  return React.createElement(
    "main",
    {
      style: {
        backgroundColor: palette.pageBg,
        color: palette.textPrimary,
        minHeight: "100vh",
        padding: "32px 24px",
        maxWidth: "560px",
        margin: "0 auto",
      },
    },
    React.createElement(
      "header",
      { style: { marginBottom: "20px" } },
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "12px",
            marginBottom: "12px",
          },
        },
        React.createElement(
          "div",
          null,
          React.createElement(
            "h1",
            { style: { fontSize: "20px", fontWeight: "700", letterSpacing: "-0.02em", marginBottom: "4px" } },
            viewProps.headerTitle || "Settings",
          ),
          React.createElement("p", { style: { fontSize: "13px", color: palette.textSecondary } }, subtitle),
        ),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () => handlers.onNavigateChat?.(),
            style: {
              backgroundColor: palette.buttonBg,
              color: palette.buttonText,
              border: `1px solid ${palette.buttonBorder}`,
              borderRadius: "7px",
              padding: "6px 12px",
              fontSize: "12px",
              cursor: "pointer",
              flexShrink: 0,
            },
          },
          "← Recommendations",
        ),
      ),
      React.createElement("hr", { style: { border: "none", borderTop: `1px solid ${palette.border}`, margin: "0" } }),
    ),
    banner,
    React.createElement(
      "section",
      {
        style: {
          marginTop: "8px",
          padding: "16px",
          borderRadius: "10px",
          border: `1px solid ${palette.border}`,
          backgroundColor: palette.cardBg,
        },
      },
      React.createElement(
        "label",
        {
          htmlFor: "gemini-api-key",
          style: { display: "block", fontSize: "12px", fontWeight: "600", color: palette.textSecondary, marginBottom: "8px" },
        },
        "Gemini API key",
      ),
      React.createElement("input", {
        id: "gemini-api-key",
        name: "geminiApiKey",
        type: "password",
        autoComplete: "off",
        value: keyDraft,
        onChange: (e) => setKeyDraft(String(/** @type {HTMLInputElement} */ (e.target).value)),
        placeholder: viewProps.hasStoredKey ? "Enter a new key to replace the saved key" : "Paste your API key",
        className: "settings-api-key-input",
        style: {
          width: "100%",
          boxSizing: "border-box",
          backgroundColor: palette.inputBg,
          color: palette.textPrimary,
          border: `1px solid ${palette.border}`,
          borderRadius: "8px",
          padding: "10px 12px",
          fontSize: "14px",
          marginBottom: "12px",
        },
      }),
      viewProps.statusMessage
        ? React.createElement(
            "p",
            {
              role: "status",
              style: {
                fontSize: "13px",
                color: viewProps.statusMessage.type === "error" ? "#e57373" : palette.accent,
                marginBottom: "12px",
              },
            },
            viewProps.statusMessage.text,
          )
        : null,
      React.createElement(
        "button",
        {
          type: "button",
          className: "settings-save-key-btn",
          onClick: () => handlers.onSaveApiKey?.(keyDraft.trim()),
          style: {
            backgroundColor: palette.accent,
            color: "#0a0d14",
            border: "none",
            borderRadius: "8px",
            padding: "10px 18px",
            fontWeight: "600",
            fontSize: "13px",
            cursor: "pointer",
          },
        },
        "Save key",
      ),
    ),
  );
}

module.exports = { SettingsView };

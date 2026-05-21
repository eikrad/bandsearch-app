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

function ApiKeyCard({ id, label, placeholder, onSave, statusMessage }) {
  const [draft, setDraft] = React.useState("");
  return React.createElement(
    "section",
    {
      style: {
        marginTop: "12px",
        padding: "16px",
        borderRadius: "10px",
        border: `1px solid ${palette.border}`,
        backgroundColor: palette.cardBg,
      },
    },
    React.createElement(
      "label",
      {
        htmlFor: id,
        style: { display: "block", fontSize: "12px", fontWeight: "600", color: palette.textSecondary, marginBottom: "8px" },
      },
      label,
    ),
    React.createElement("input", {
      id,
      name: id,
      type: "password",
      autoComplete: "off",
      value: draft,
      onChange: (e) => setDraft(String(/** @type {HTMLInputElement} */ (e.target).value)),
      placeholder,
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
    statusMessage
      ? React.createElement(
          "p",
          {
            role: "status",
            style: {
              fontSize: "13px",
              color: statusMessage.type === "error" ? "#e57373" : palette.accent,
              marginBottom: "12px",
            },
          },
          statusMessage.text,
        )
      : null,
    React.createElement(
      "button",
      {
        type: "button",
        className: "settings-save-key-btn",
        onClick: () => onSave?.(draft.trim()),
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
  );
}

function SettingsView({ viewProps, handlers }) {
  const subtitle =
    viewProps.headerSubtitle ||
    "Your keys are stored locally on this device and passed to the Bandsearch API process.";

  const missingKeys = [];
  if (viewProps.hasStoredKey === false) missingKeys.push("Gemini");
  if (viewProps.hasBraveKey === false) missingKeys.push("Brave Search");

  const banner =
    missingKeys.length > 0
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
          `${missingKeys.join(" and ")} API ${missingKeys.length === 1 ? "key is" : "keys are"} not configured yet. Add ${missingKeys.length === 1 ? "it" : "them"} below so recommendations can run.`,
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
    React.createElement(ApiKeyCard, {
      id: "gemini-api-key",
      label: "Gemini API key",
      placeholder: viewProps.hasStoredKey ? "Enter a new key to replace the saved key" : "Paste your Gemini API key",
      onSave: (key) => handlers.onSaveApiKey?.(key),
      statusMessage: viewProps.geminiStatusMessage ?? null,
    }),
    React.createElement(ApiKeyCard, {
      id: "brave-api-key",
      label: "Brave Search API key",
      placeholder: viewProps.hasBraveKey ? "Enter a new key to replace the saved key" : "Paste your Brave Search API key",
      onSave: (key) => handlers.onSaveBraveApiKey?.(key),
      statusMessage: viewProps.braveStatusMessage ?? null,
    }),
  );
}

module.exports = { SettingsView };

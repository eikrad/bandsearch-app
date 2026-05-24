import * as React from "react";

const palette = {
  pageBg: "#0d0f14",
  cardBg: "#111827",
  border: "#1e2a3a",
  textPrimary: "#f0f4f8",
  textSecondary: "#8896a8",
  accent: "#7aa7d9",
  buttonBg: "#161e2e",
  buttonBorder: "#243044",
  buttonText: "#c8d4e8",
};

/**
 * First-run welcome: guides the user to add a Gemini API key (Settings) or skip for later.
 */
export function WelcomeView({ viewProps, handlers }: { viewProps: any; handlers: any }) {
  void viewProps;
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
      { style: { marginBottom: "24px" } },
      React.createElement(
        "h1",
        { style: { fontSize: "22px", fontWeight: "700", letterSpacing: "-0.02em", marginBottom: "10px" } },
        "Welcome to Bandsearch",
      ),
      React.createElement(
        "p",
        { style: { fontSize: "14px", color: palette.textSecondary, lineHeight: 1.55, margin: 0 } },
        "Bandsearch uses Google Gemini for niche music recommendations. Add a Gemini API key once on this device, then you can start chatting. You can change it anytime in Settings.",
      ),
    ),
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          marginTop: "8px",
        },
      },
      React.createElement(
        "button",
        {
          type: "button",
          className: "welcome-add-key-btn",
          onClick: () => handlers.onGoToSettings?.(),
          style: {
            backgroundColor: palette.accent,
            color: "#0a0d14",
            border: "none",
            borderRadius: "8px",
            padding: "12px 18px",
            fontWeight: "600",
            fontSize: "14px",
            cursor: "pointer",
          },
        },
        "Add API key",
      ),
      React.createElement(
        "button",
        {
          type: "button",
          className: "welcome-skip-btn",
          onClick: () => handlers.onSkip?.(),
          style: {
            backgroundColor: palette.buttonBg,
            color: palette.buttonText,
            border: `1px solid ${palette.buttonBorder}`,
            borderRadius: "8px",
            padding: "10px 18px",
            fontWeight: "500",
            fontSize: "13px",
            cursor: "pointer",
          },
        },
        "Skip for now",
      ),
    ),
  );
}

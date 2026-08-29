import * as React from "react";
import { PRIVACY_POLICY, LAST_UPDATED } from "./privacyPolicyText.js";

// Same palette as SettingsView — this is a settings-adjacent screen and should
// not look like a different app.
const palette = {
  pageBg: "#0d0f14",
  cardBg: "#111827",
  border: "#1e2a3a",
  textPrimary: "#f0f4f8",
  textSecondary: "#8896a8",
  textTertiary: "#5a6880",
  buttonBg: "#161e2e",
  buttonBorder: "#243044",
  buttonText: "#c8d4e8",
};

export type PrivacyPolicyHandlers = { onBack: () => void };

export function PrivacyPolicyView({ handlers }: { handlers: PrivacyPolicyHandlers }) {
  const onBack = handlers.onBack;
  return React.createElement(
    "main",
    {
      className: "bandsearch-privacy-view",
      style: {
        backgroundColor: palette.pageBg,
        color: palette.textPrimary,
        padding: "32px 24px",
        maxWidth: "760px",
        margin: "0 auto",
      },
    },
    React.createElement(
      "div",
      { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" } },
      React.createElement(
        "h1",
        { style: { fontSize: "20px", fontWeight: 700, letterSpacing: "-0.02em" } },
        "Privacy policy",
      ),
      React.createElement(
        "button",
        {
          type: "button",
          className: "action-btn",
          onClick: onBack,
          style: {
            backgroundColor: palette.buttonBg,
            color: palette.buttonText,
            border: `1px solid ${palette.buttonBorder}`,
            borderRadius: "7px",
            padding: "5px 12px",
            fontSize: "12px",
          },
        },
        "Back",
      ),
    ),
    React.createElement(
      "p",
      { style: { fontSize: "12px", color: palette.textTertiary, marginBottom: "24px" } },
      `Last updated ${LAST_UPDATED}`,
    ),
    ...PRIVACY_POLICY.map((section) =>
      React.createElement(
        "section",
        {
          key: section.heading,
          style: {
            backgroundColor: palette.cardBg,
            border: `1px solid ${palette.border}`,
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "12px",
          },
        },
        React.createElement(
          "h2",
          { style: { fontSize: "13px", fontWeight: 600, marginBottom: "8px", letterSpacing: "-0.01em" } },
          section.heading,
        ),
        ...section.paragraphs.map((paragraph, i) =>
          React.createElement(
            "p",
            {
              key: i,
              style: {
                fontSize: "13px",
                color: palette.textSecondary,
                lineHeight: 1.6,
                marginBottom: i === section.paragraphs.length - 1 ? 0 : "8px",
              },
            },
            paragraph,
          ),
        ),
      ),
    ),
  );
}

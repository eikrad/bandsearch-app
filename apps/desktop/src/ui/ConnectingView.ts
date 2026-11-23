import type { ConnectingHandlers, ConnectingViewProps } from "./viewTypes.js";
import * as React from "react";
import { t } from "../i18n/i18n.js";

const palette = {
  pageBg: "#0d0f14",
  border: "#1e2a3a",
  textPrimary: "#f0f4f8",
  textSecondary: "#8896a8",
  accent: "#7aa7d9",
  buttonBg: "#161e2e",
  buttonBorder: "#243044",
  buttonText: "#c8d4e8",
};

/** After this many attempts the wait is long enough to deserve acknowledging. */
const LONG_WAIT_AFTER_ATTEMPTS = 4;

/**
 * Shown while the API is being polled at startup, and when polling gave up.
 *
 * Exists because an unreachable API used to be indistinguishable from "auth is
 * switched off" (#155), which dropped the user into a chat where every request
 * then failed. A hosted instance that has spun down takes 30-60s to answer, so
 * the honest thing is to say so and keep trying.
 */
export function ConnectingView({
  viewProps,
  handlers,
}: {
  viewProps: ConnectingViewProps;
  handlers: ConnectingHandlers;
}) {
  const waiting = viewProps.state === "waiting";
  const longWait = waiting && (viewProps.attempt ?? 1) >= LONG_WAIT_AFTER_ATTEMPTS;

  return React.createElement(
    "main",
    {
      style: {
        backgroundColor: palette.pageBg,
        color: palette.textPrimary,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
        padding: "32px 24px",
        textAlign: "center",
      },
    },
    React.createElement(
      "h1",
      { style: { fontSize: "15px", fontWeight: 700, letterSpacing: "-0.01em" } },
      waiting ? (longWait ? t("connecting.longWaitTitle") : t("connecting.waitingTitle")) : t("connecting.failedTitle"),
    ),
    React.createElement(
      "p",
      { style: { fontSize: "13px", color: palette.textSecondary, maxWidth: "36ch", lineHeight: 1.5 } },
      waiting
        ? longWait
          ? t("connecting.longWaitBody")
          : t("connecting.waitingBody")
        : t("connecting.failedBody"),
    ),
    waiting
      ? null
      : React.createElement(
          "button",
          {
            type: "button",
            onClick: () => handlers.onRetry?.(),
            style: {
              backgroundColor: palette.buttonBg,
              color: palette.buttonText,
              border: `1px solid ${palette.buttonBorder}`,
              borderRadius: "7px",
              // 44px minimum touch target, per the locked responsiveness policy.
              minHeight: "44px",
              padding: "0 20px",
              fontSize: "13px",
              cursor: "pointer",
            },
          },
          t("connecting.retry"),
        ),
  );
}

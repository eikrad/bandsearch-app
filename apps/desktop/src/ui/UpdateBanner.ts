import type { UpdateBannerHandlers } from "./viewTypes.js";
import * as React from "react";
import { t } from "../i18n/i18n.js";

const palette = {
  bg: "#16233b",
  border: "#2c3e5c",
  text: "#f0f4f8",
  accent: "#7aa7d9",
  installText: "#0a0d14",
  laterText: "#c8d4e8",
};

export type UpdateBannerViewProps = {
  version: string;
  canAutoInstall: boolean;
};

/**
 * Dismissible, `position: fixed` banner shown above every screen when a newer
 * version is available. On Windows/Linux it offers a one-click Install;
 * macOS testers (no signed updater artifact yet) only see the version note.
 */
export function UpdateBanner({
  viewProps,
  handlers,
}: {
  viewProps: UpdateBannerViewProps;
  handlers: UpdateBannerHandlers;
}) {
  const { version, canAutoInstall } = viewProps;
  return React.createElement(
    "div",
    {
      className: "update-banner",
      style: {
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "16px",
        padding: "10px 16px",
        backgroundColor: palette.bg,
        borderBottom: `1px solid ${palette.border}`,
        color: palette.text,
        fontSize: "13px",
      },
    },
    React.createElement("span", null, t("update.available", { version })),
    canAutoInstall &&
      React.createElement(
        "button",
        {
          type: "button",
          className: "update-banner-install-btn",
          onClick: () => handlers.onInstall?.(),
          style: {
            backgroundColor: palette.accent,
            color: palette.installText,
            border: "none",
            borderRadius: "6px",
            padding: "6px 14px",
            fontWeight: "600",
            fontSize: "13px",
            cursor: "pointer",
          },
        },
        t("update.install"),
      ),
    React.createElement(
      "button",
      {
        type: "button",
        className: "update-banner-dismiss-btn",
        onClick: () => handlers.onDismiss?.(),
        style: {
          background: "none",
          border: "none",
          color: palette.laterText,
          fontSize: "13px",
          cursor: "pointer",
          padding: 0,
        },
      },
      t("update.later"),
    ),
  );
}

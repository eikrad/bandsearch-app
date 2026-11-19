import * as React from "react";
import type { StatusMessage } from "../statusMessage.js";

/** The one-line outcome of the last action, as the chat and Saved Artists show it. */
export function StatusBanner({ status }: { status: StatusMessage | null | undefined }) {
  if (!status) return null;
  const isError = status.type === "error";
  return React.createElement(
    "p",
    {
      // An error interrupts a screen reader; a confirmation waits its turn.
      role: isError ? "alert" : "status",
      style: {
        margin: "0 0 16px 0",
        padding: "9px 12px",
        borderRadius: "8px",
        fontSize: "13px",
        backgroundColor: isError ? "#2a1218" : "#0f2318",
        color: isError ? "#f8a8b0" : "#7dd4a8",
        border: `1px solid ${isError ? "#7a2a35" : "#2a6048"}`,
      },
    },
    status.message,
  );
}

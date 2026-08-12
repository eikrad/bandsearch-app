import { startDesktopBrowserApp } from "./startDesktopBrowserApp.js";
import type { StartDesktopBrowserAppOptions } from "./startDesktopBrowserApp.js";

function canAutoBoot(): boolean {
  return typeof globalThis !== "undefined" && !!globalThis.document;
}

export function bootBrowserDesktopApp(options: StartDesktopBrowserAppOptions = {}) {
  const p = startDesktopBrowserApp(options);
  if (p && typeof p.catch === "function") {
    void p.catch((err: unknown) => {
      console.error("[bandsearch] boot failed", err);
    });
  }
  return p;
}

if (canAutoBoot()) {
  const doc = globalThis.document;
  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", () => {
      void bootBrowserDesktopApp();
    });
  } else {
    void bootBrowserDesktopApp();
  }
}

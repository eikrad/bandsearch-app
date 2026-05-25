import { startDesktopBrowserApp } from "./startDesktopBrowserApp.js";

function canAutoBoot(): boolean {
  return typeof globalThis !== "undefined" && !!(globalThis as any).document;
}

export function bootBrowserDesktopApp(options: Record<string, any> = {}): any {
  const p = startDesktopBrowserApp(options);
  if (p && typeof (p as any).catch === "function") {
    void (p as any).catch((err: unknown) => {
      console.error("[bandsearch] boot failed", err);
    });
  }
  return p;
}

if (canAutoBoot()) {
  const doc = (globalThis as any).document;
  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", () => {
      void bootBrowserDesktopApp();
    });
  } else {
    void bootBrowserDesktopApp();
  }
}

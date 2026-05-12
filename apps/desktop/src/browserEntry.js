const { startDesktopBrowserApp } = require("./startDesktopBrowserApp");

function canAutoBoot() {
  return typeof globalThis !== "undefined" && !!globalThis.document;
}

function bootBrowserDesktopApp(options = {}) {
  const p = startDesktopBrowserApp(options);
  if (p && typeof p.catch === "function") {
    void p.catch((err) => {
      console.error("[bandsearch] boot failed", err);
    });
  }
  return p;
}

if (canAutoBoot()) {
  if (globalThis.document.readyState === "loading") {
    globalThis.document.addEventListener("DOMContentLoaded", () => {
      void bootBrowserDesktopApp();
    });
  } else {
    void bootBrowserDesktopApp();
  }
}

module.exports = {
  bootBrowserDesktopApp,
};

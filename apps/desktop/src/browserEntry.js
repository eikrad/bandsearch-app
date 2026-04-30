const { startDesktopBrowserApp } = require("./startDesktopBrowserApp");

function canAutoBoot() {
  return typeof globalThis !== "undefined" && !!globalThis.document;
}

function bootBrowserDesktopApp(options = {}) {
  return startDesktopBrowserApp(options);
}

if (canAutoBoot()) {
  if (globalThis.document.readyState === "loading") {
    globalThis.document.addEventListener("DOMContentLoaded", () => {
      bootBrowserDesktopApp();
    });
  } else {
    bootBrowserDesktopApp();
  }
}

module.exports = {
  bootBrowserDesktopApp,
};

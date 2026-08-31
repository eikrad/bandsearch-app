export type OpenUrlFn = (url: string) => Promise<void> | void;

function browserWindow(): Window | undefined {
  return (globalThis as unknown as { window?: Window }).window;
}

function fallbackOpenUrl(url: string): void {
  browserWindow()?.open(url, "_blank", "noopener,noreferrer");
}

/**
 * A plain `<a target="_blank">` click does nothing in the Tauri webview — there
 * is no browser tab for it to open. `@tauri-apps/plugin-opener` is the intended
 * replacement; outside a Tauri host (browser dev) it is absent, so window.open
 * is the fallback. Same require-and-catch shape as createDefaultTauriInvoke in
 * startDesktopBrowserApp.ts.
 */
export function resolveOpenUrl(
  loadOpener: () => { openUrl: OpenUrlFn } = () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("@tauri-apps/plugin-opener") as { openUrl: OpenUrlFn },
): OpenUrlFn {
  try {
    return loadOpener().openUrl;
  } catch {
    return fallbackOpenUrl;
  }
}

export const openExternalLink: OpenUrlFn = (url) => resolveOpenUrl()(url);

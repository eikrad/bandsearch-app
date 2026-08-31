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
 * replacement; outside a Tauri host (browser dev) window.open is the fallback.
 *
 * The require() alone succeeds even in browser dev — esbuild bundles the
 * package regardless of whether a Tauri host answers it — so it cannot be the
 * only thing guarded. openUrl() itself calls invoke() under the hood, which
 * only fails once there is no IPC bridge to answer it, asynchronously. Both
 * stages have to be caught, or browser dev silently does nothing.
 */
export function resolveOpenUrl(
  loadOpener: () => { openUrl: OpenUrlFn } = () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("@tauri-apps/plugin-opener") as { openUrl: OpenUrlFn },
): OpenUrlFn {
  return async (url: string) => {
    try {
      await loadOpener().openUrl(url);
    } catch {
      fallbackOpenUrl(url);
    }
  };
}

export const openExternalLink: OpenUrlFn = (url) => resolveOpenUrl()(url);

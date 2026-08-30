/** localStorage key: version string the user last dismissed the update banner for. */
export const UPDATE_DISMISSED_VERSION_STORAGE_KEY = "bandsearch_update_dismissed_version";

export interface UpdateDismissalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The `update-available` Tauri event payload emitted from main.rs's setup hook. */
export type UpdateAvailablePayload = {
  version: string;
  canAutoInstall: boolean;
};

/**
 * Show the banner when an update was reported and its version was not the
 * one the user last dismissed. Dismissal is per-version, so a later update
 * shows again even if an earlier one was dismissed.
 */
export function shouldShowUpdateBanner(input: {
  availableVersion: string | undefined;
  dismissedVersion: string | undefined;
}): boolean {
  if (!input.availableVersion) return false;
  return input.availableVersion !== input.dismissedVersion;
}

export function getDismissedUpdateVersion(storage: UpdateDismissalStorage): string | undefined {
  return storage.getItem(UPDATE_DISMISSED_VERSION_STORAGE_KEY) ?? undefined;
}

export function dismissUpdateVersion(storage: UpdateDismissalStorage, version: string): void {
  storage.setItem(UPDATE_DISMISSED_VERSION_STORAGE_KEY, version);
}

export interface UpdateNotificationControllerOptions {
  storage: UpdateDismissalStorage;
  /** Invokes the backend install command. Injected so tests need no Tauri host. */
  installUpdate: () => Promise<void>;
  onInstallError?: (error: unknown) => void;
}

/**
 * Owns "an update is available" for the lifetime of the app: the decision, the
 * per-version dismissal, and the banner's handlers — so no caller has to
 * sequence those correctly by hand.
 *
 * Crucially it decouples *when the update is reported* from *when the UI can
 * render it*. The Rust check runs from `.setup()` and can emit before the
 * webview has booted; Tauri's `emit` has no replay buffer, so a payload that
 * arrives before `attach()` is held and flushed on attach rather than lost for
 * that launch.
 */
export function createUpdateNotificationController({
  storage,
  installUpdate,
  onInstallError,
}: UpdateNotificationControllerOptions) {
  let showBanner: ((viewProps: UpdateAvailablePayload | null) => void) | undefined;
  /** Reported while no renderer was attached yet; flushed by attach(). */
  let buffered: UpdateAvailablePayload | undefined;
  /** The update currently on display, needed to persist the right dismissal. */
  let current: UpdateAvailablePayload | undefined;

  return {
    /** Feed in an `update-available` payload. Safe to call before attach(). */
    updateAvailable(payload: UpdateAvailablePayload): void {
      const dismissedVersion = getDismissedUpdateVersion(storage);
      if (!shouldShowUpdateBanner({ availableVersion: payload.version, dismissedVersion })) return;
      current = payload;
      if (showBanner) showBanner(payload);
      else buffered = payload;
    },

    /** Connect the renderer once the UI can paint, flushing anything buffered. */
    attach(show: (viewProps: UpdateAvailablePayload | null) => void): void {
      showBanner = show;
      if (buffered) {
        show(buffered);
        buffered = undefined;
      }
    },

    handlers: {
      onDismiss(): void {
        if (current) dismissUpdateVersion(storage, current.version);
        current = undefined;
        showBanner?.(null);
      },
      async onInstall(): Promise<void> {
        // A rejection here would land in a click handler with nobody to catch
        // it; the controller owns install failure so the caller cannot forget.
        try {
          await installUpdate();
        } catch (error) {
          onInstallError?.(error);
        }
      },
    },
  };
}

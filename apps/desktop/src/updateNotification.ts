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

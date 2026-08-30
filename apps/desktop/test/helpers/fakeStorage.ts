import type { UpdateDismissalStorage } from "../../src/updateNotification.js";

/** In-memory stand-in for the one-key dismissal store, so tests need no localStorage. */
export function fakeUpdateStorage(initial: Record<string, string> = {}): UpdateDismissalStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

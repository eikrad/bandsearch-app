/**
 * The search the app is waiting for, kept on the device so the app can pick it
 * up again after the system stopped it (ADR 0006): the job id, and the question
 * with how it was asked, to show it again and to offer Retry. Cleared once the
 * answer or the error was shown, or the user stopped the search.
 */
export type PendingSearch = {
  jobId: string;
  query: string;
  mode: string;
  obscurityTarget?: string;
};

export type PendingSearchStore = {
  get(): PendingSearch | null;
  set(search: PendingSearch): void;
  clear(): void;
};

const PENDING_SEARCH_KEY = "bandsearch_pending_search";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function parse(raw: string | null): PendingSearch | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { jobId, query, mode, obscurityTarget } = value as Record<string, unknown>;
    if (typeof jobId !== "string" || !jobId || typeof query !== "string" || typeof mode !== "string") return null;
    return { jobId, query, mode, ...(typeof obscurityTarget === "string" ? { obscurityTarget } : {}) };
  } catch {
    return null;
  }
}

/**
 * Local storage can be missing, full or refused (private mode, a locked-down
 * webview): every access is guarded, and without it the app works as before,
 * only without picking a search up after a restart.
 */
export function createPendingSearchStore(
  storage: () => KeyValueStorage | undefined = () => globalThis.localStorage,
): PendingSearchStore {
  return {
    get() {
      try {
        return parse(storage()?.getItem(PENDING_SEARCH_KEY) ?? null);
      } catch {
        return null;
      }
    },
    set(search) {
      try {
        storage()?.setItem(PENDING_SEARCH_KEY, JSON.stringify(search));
      } catch { /* the search still runs; it just cannot be picked up after a restart */ }
    },
    clear() {
      try {
        storage()?.removeItem(PENDING_SEARCH_KEY);
      } catch { /* nothing to clear */ }
    },
  };
}

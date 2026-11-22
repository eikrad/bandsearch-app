export type TtlCache<T> = {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
};

/** A bounded in-memory cache; entries expire after `ttlMs`, the oldest go first when it is full. */
export function createTtlCache<T>({ ttlMs, maxEntries }: { ttlMs: number; maxEntries: number }): TtlCache<T> {
  const entries = new Map<string, { value: T; expiresAt: number }>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      if (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    },
  };
}

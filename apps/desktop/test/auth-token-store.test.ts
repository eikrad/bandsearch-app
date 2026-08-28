import test from "node:test";
import assert from "node:assert/strict";

import { clearAuthToken, getAuthToken, setAuthToken } from "../src/authTokenStore.js";

const STORAGE_KEY = "bandsearch_auth_token";

/**
 * The store reads the ambient `localStorage`, so these tests install one on
 * `globalThis` for the duration of each case.
 *
 * The throwing variant is the case that matters: a browser with site data
 * blocked throws on access rather than returning null, and every one of these
 * functions is written to swallow that. Nothing exercised those catch blocks
 * before, so a token store that threw on a private window would have shipped.
 */
function withLocalStorage(impl: Partial<Storage>, run: () => void) {
  const original = Reflect.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    value: impl as Storage,
    configurable: true,
    writable: true,
  });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    store: data,
    impl: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    } as Partial<Storage>,
  };
}

const throwingStorage: Partial<Storage> = {
  getItem: () => {
    throw new Error("site data blocked");
  },
  setItem: () => {
    throw new Error("site data blocked");
  },
  removeItem: () => {
    throw new Error("site data blocked");
  },
};

test("getAuthToken returns the stored token", () => {
  const { impl } = memoryStorage({ [STORAGE_KEY]: "tok-1" });

  withLocalStorage(impl, () => {
    assert.equal(getAuthToken(), "tok-1");
  });
});

test("getAuthToken returns null when nothing is stored", () => {
  const { impl } = memoryStorage();

  withLocalStorage(impl, () => {
    assert.equal(getAuthToken(), null);
  });
});

test("setAuthToken stores the token under the shared key", () => {
  const { impl, store } = memoryStorage();

  withLocalStorage(impl, () => {
    setAuthToken("tok-2");
  });

  // tests/e2e/auth.setup.ts writes this same key directly, so the two must agree.
  assert.equal(store.get(STORAGE_KEY), "tok-2");
});

test("setAuthToken overwrites an existing token", () => {
  const { impl, store } = memoryStorage({ [STORAGE_KEY]: "old" });

  withLocalStorage(impl, () => {
    setAuthToken("new");
  });

  assert.equal(store.get(STORAGE_KEY), "new");
});

test("clearAuthToken removes the token", () => {
  const { impl, store } = memoryStorage({ [STORAGE_KEY]: "tok-3" });

  withLocalStorage(impl, () => {
    clearAuthToken();
  });

  assert.equal(store.has(STORAGE_KEY), false);
});

test("a stored token round-trips through set and get", () => {
  const { impl } = memoryStorage();

  withLocalStorage(impl, () => {
    setAuthToken("tok-4");
    assert.equal(getAuthToken(), "tok-4");
    clearAuthToken();
    assert.equal(getAuthToken(), null);
  });
});

test("getAuthToken returns null when localStorage throws", () => {
  withLocalStorage(throwingStorage, () => {
    assert.equal(getAuthToken(), null);
  });
});

test("setAuthToken does not throw when localStorage throws", () => {
  withLocalStorage(throwingStorage, () => {
    assert.doesNotThrow(() => setAuthToken("tok-5"));
  });
});

test("clearAuthToken does not throw when localStorage throws", () => {
  withLocalStorage(throwingStorage, () => {
    assert.doesNotThrow(() => clearAuthToken());
  });
});

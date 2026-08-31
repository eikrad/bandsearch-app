import test from "node:test";
import assert from "node:assert/strict";

import { getChatSessionId, setChatSessionId } from "../src/chatSessionStore.js";

const STORAGE_KEY = "bandsearch_chat_session_id";

// Same rationale as auth-token-store.test.ts: the store reads the ambient
// localStorage, and a browser with site data blocked throws on access rather
// than returning null, so the throwing case is the one that matters.
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
};

test("getChatSessionId returns null when nothing is stored", () => {
  const { impl } = memoryStorage();
  withLocalStorage(impl, () => {
    assert.equal(getChatSessionId(), null);
  });
});

test("a stored session id round-trips through set and get", () => {
  const { impl } = memoryStorage();
  withLocalStorage(impl, () => {
    setChatSessionId("sess-1");
    assert.equal(getChatSessionId(), "sess-1");
  });
});

test("setChatSessionId stores the id under the shared key", () => {
  const { impl, store } = memoryStorage();
  withLocalStorage(impl, () => {
    setChatSessionId("sess-2");
  });
  assert.equal(store.get(STORAGE_KEY), "sess-2");
});

test("getChatSessionId returns null when localStorage throws", () => {
  withLocalStorage(throwingStorage, () => {
    assert.equal(getChatSessionId(), null);
  });
});

test("setChatSessionId does not throw when localStorage throws", () => {
  withLocalStorage(throwingStorage, () => {
    assert.doesNotThrow(() => setChatSessionId("sess-2"));
  });
});

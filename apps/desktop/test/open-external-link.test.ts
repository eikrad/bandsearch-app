import test from "node:test";
import assert from "node:assert/strict";
import { resolveOpenUrl } from "../src/openExternalLink.js";

test("resolveOpenUrl delegates to the Tauri opener plugin when present", () => {
  const calls: string[] = [];
  const openUrl = resolveOpenUrl(() => ({
    openUrl: (url: string) => {
      calls.push(url);
    },
  }));

  openUrl("https://bandcamp.com/search?q=Fen");

  assert.deepEqual(calls, ["https://bandcamp.com/search?q=Fen"]);
});

test("resolveOpenUrl falls back to window.open outside a Tauri host", () => {
  const calls: Array<{ url: string; target?: string }> = [];
  (globalThis as unknown as { window: unknown }).window = {
    open: (url: string, target?: string) => {
      calls.push({ url, target });
    },
  };

  try {
    const openUrl = resolveOpenUrl(() => {
      throw new Error("no Tauri host");
    });

    openUrl("https://open.spotify.com/search/Fen");

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://open.spotify.com/search/Fen");
    assert.equal(calls[0].target, "_blank");
  } finally {
    delete (globalThis as unknown as { window?: unknown }).window;
  }
});

test("resolveOpenUrl falls back to window.open when openUrl itself rejects (require succeeded, invoke had no host to answer it)", async () => {
  const calls: Array<{ url: string; target?: string }> = [];
  (globalThis as unknown as { window: unknown }).window = {
    open: (url: string, target?: string) => {
      calls.push({ url, target });
    },
  };

  try {
    const openUrl = resolveOpenUrl(() => ({
      openUrl: async () => {
        throw new Error("invoke() had no Tauri host to answer it");
      },
    }));

    await openUrl("https://soundcloud.com/search?q=Fen");

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://soundcloud.com/search?q=Fen");
    assert.equal(calls[0].target, "_blank");
  } finally {
    delete (globalThis as unknown as { window?: unknown }).window;
  }
});

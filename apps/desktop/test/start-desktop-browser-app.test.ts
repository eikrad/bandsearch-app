import test from "node:test";
import assert from "node:assert/strict";
import { startDesktopBrowserApp } from "../src/startDesktopBrowserApp.js";
import { bootstrapDesktopApp } from "../src/index.js";
import { jsonResponse } from "./helpers/fakeResponse.js";
import { fakeMediaQueryList } from "./helpers/fakeDom.js";

// One flat record instead of a discriminated union: the assertions read a single
// field per call and stay free of narrowing noise.
type BootstrapCall = {
  type: "bootstrapApp" | "bootstrapReact" | "mount";
  apiBaseUrl?: string;
  viewport?: string;
  saveApiEndpointUrl?: unknown;
};

test("startDesktopBrowserApp mounts bootstrapped react app", async () => {
  const calls: BootstrapCall[] = [];

  await startDesktopBrowserApp({
    apiBaseUrl: "http://localhost:3333",
    viewport: "mobile",
    actionHandlers: { onSave: () => {} },
    deps: {
      // Delegating to the real bootstrap keeps a genuine app object in play, so
      // only the construction call is observed.
      bootstrapDesktopApp: (options) => {
        calls.push({ type: "bootstrapApp", apiBaseUrl: options.apiBaseUrl });
        return bootstrapDesktopApp(options);
      },
      bootstrapDesktopReactApp: ({ viewport }) => {
        calls.push({ type: "bootstrapReact", viewport });
        return {
          mount: async () => {
            calls.push({ type: "mount" });
          },
        };
      },
    },
  });

  assert.deepEqual(
    calls.map((c) => c.type),
    ["bootstrapApp", "bootstrapReact", "mount"],
  );
  assert.equal(calls[0].apiBaseUrl, "http://localhost:3333");
  assert.equal(calls[1].viewport, "mobile");
});

test("startDesktopBrowserApp uses the configured remote endpoint as the API base URL", async () => {
  const calls: BootstrapCall[] = [];
  const fakeFetch: typeof fetch = async () => jsonResponse({ enabled: false, userCount: 0 });

  await startDesktopBrowserApp({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: fakeFetch,
    invokeTauri: async (cmd) => {
      if (cmd === "gemini_config_status") {
        return { hasStoredKey: true, onboardingComplete: true, apiEndpointUrl: "https://bandsearch.onrender.com" };
      }
      return {};
    },
    deps: {
      bootstrapDesktopApp: (options) => {
        calls.push({ type: "bootstrapApp", apiBaseUrl: options.apiBaseUrl });
        return bootstrapDesktopApp(options);
      },
      bootstrapDesktopReactApp: ({ saveApiEndpointUrl }) => {
        calls.push({ type: "bootstrapReact", saveApiEndpointUrl });
        return {
          mount: async () => {
            calls.push({ type: "mount" });
          },
        };
      },
    },
  });

  const appCall = calls.find((c) => c.type === "bootstrapApp");
  assert.ok(appCall, "bootstrapDesktopApp should be called");
  assert.equal(appCall.apiBaseUrl, "https://bandsearch.onrender.com");
  const reactCall = calls.find((c) => c.type === "bootstrapReact");
  assert.equal(typeof reactCall?.saveApiEndpointUrl, "function", "should wire saveApiEndpointUrl through");
});

test("startDesktopBrowserApp picks mobile viewport when matchMedia matches narrow width", async () => {
  const calls: BootstrapCall[] = [];
  const prevWindow = globalThis.window;
  globalThis.window = {
    matchMedia: (query: string) => fakeMediaQueryList(query.includes("max-width")),
  } as unknown as typeof globalThis.window;

  try {
    await startDesktopBrowserApp({
      viewport: "desktop",
      deps: {
        bootstrapDesktopApp: (options) => bootstrapDesktopApp(options),
        bootstrapDesktopReactApp: ({ viewport }) => {
          calls.push({ type: "bootstrapReact", viewport });
          return {
            mount: async () => {
              calls.push({ type: "mount" });
            },
            desktopUi: { setViewport: () => {} },
          };
        },
      },
    });
  } finally {
    globalThis.window = prevWindow;
  }

  assert.equal(calls[0].type, "bootstrapReact");
  assert.equal(calls[0].viewport, "mobile");
});

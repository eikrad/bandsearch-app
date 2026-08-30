import test from "node:test";
import assert from "node:assert/strict";
import { startDesktopBrowserApp } from "../src/startDesktopBrowserApp.js";
import { bootstrapDesktopApp, bootstrapDesktopReactApp } from "../src/index.js";
import { jsonResponse } from "./helpers/fakeResponse.js";
import { fakeMediaQueryList, fakeWindow } from "./helpers/fakeDom.js";
import { fakeUpdateStorage } from "./helpers/fakeStorage.js";
import type { UpdateAvailablePayload, UpdateDismissalStorage } from "../src/updateNotification.js";
import type { UpdateBannerHandlers } from "../src/ui/viewTypes.js";

// One flat record instead of a discriminated union: the assertions read a single
// field per call and stay free of narrowing noise.
type BootstrapCall = {
  type: "bootstrapApp" | "bootstrapReact" | "mount";
  apiBaseUrl?: string;
  viewport?: string;
  saveApiEndpointUrl?: unknown;
};

type BootstrappedReactApp = ReturnType<typeof bootstrapDesktopReactApp>;

// The real bootstrap hands back a full mount API and UI stack; these tests only
// drive `mount` and the viewport hook, so the rest is narrowed away here.
type ReactAppDouble = Partial<Omit<BootstrappedReactApp, "desktopUi">> & {
  desktopUi?: { setViewport: (viewport: string) => void };
};

function fakeReactApp(overrides: ReactAppDouble): BootstrappedReactApp {
  return overrides as BootstrappedReactApp;
}

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
        calls.push({ type: "bootstrapApp", apiBaseUrl: options?.apiBaseUrl });
        return bootstrapDesktopApp(options);
      },
      bootstrapDesktopReactApp: ({ viewport }) => {
        calls.push({ type: "bootstrapReact", viewport });
        return fakeReactApp({
          mount: async () => {
            calls.push({ type: "mount" });
            return {};
          },
        });
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
        calls.push({ type: "bootstrapApp", apiBaseUrl: options?.apiBaseUrl });
        return bootstrapDesktopApp(options);
      },
      bootstrapDesktopReactApp: ({ saveApiEndpointUrl }) => {
        calls.push({ type: "bootstrapReact", saveApiEndpointUrl });
        return fakeReactApp({
          mount: async () => {
            calls.push({ type: "mount" });
            return {};
          },
        });
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
  globalThis.window = fakeWindow({
    matchMedia: (query: string) => fakeMediaQueryList(query.includes("max-width")),
  });

  try {
    await startDesktopBrowserApp({
      viewport: "desktop",
      deps: {
        bootstrapDesktopApp: (options) => bootstrapDesktopApp(options),
        bootstrapDesktopReactApp: ({ viewport }) => {
          calls.push({ type: "bootstrapReact", viewport });
          return fakeReactApp({
            mount: async () => {
              calls.push({ type: "mount" });
              return {};
            },
            desktopUi: { setViewport: () => {} },
          });
        },
      },
    });
  } finally {
    globalThis.window = prevWindow;
  }

  assert.equal(calls[0].type, "bootstrapReact");
  assert.equal(calls[0].viewport, "mobile");
});

/**
 * Boots the app with the update collaborators injected, and hands back the
 * banner calls, the banner handlers, and a `fire` that plays an
 * `update-available` event through whatever listener the app subscribed.
 */
async function startWithUpdateDeps(
  overrides: {
    updateDismissalStorage?: UpdateDismissalStorage;
    invokeTauri?: (cmd: string, args?: Record<string, string>) => Promise<unknown>;
  } = {},
) {
  let listener: ((payload: UpdateAvailablePayload) => void) | undefined;
  let updateBannerHandlers: UpdateBannerHandlers | undefined;
  const showUpdateBannerCalls: Array<UpdateAvailablePayload | null> = [];

  await startDesktopBrowserApp({
    listenUpdateAvailable: (handler) => { listener = handler; },
    updateDismissalStorage: overrides.updateDismissalStorage ?? fakeUpdateStorage(),
    invokeTauri: overrides.invokeTauri ?? (async () => ({})),
    deps: {
      bootstrapDesktopApp: (options) => bootstrapDesktopApp(options),
      bootstrapDesktopReactApp: (options) => {
        updateBannerHandlers = options.updateBannerHandlers;
        return fakeReactApp({
          mount: async () => ({}),
          showUpdateBanner: (payload) => { showUpdateBannerCalls.push(payload); },
        });
      },
    },
  });

  return {
    showUpdateBannerCalls,
    updateBannerHandlers,
    fire: (payload: UpdateAvailablePayload) => listener?.(payload),
  };
}

const AN_UPDATE: UpdateAvailablePayload = { version: "0.5.0", canAutoInstall: true };

test("an update-available payload makes the banner appear", async () => {
  const app = await startWithUpdateDeps();

  app.fire(AN_UPDATE);

  assert.deepEqual(app.showUpdateBannerCalls, [AN_UPDATE]);
});

test("the app subscribes before bootstrap finishes, so no update is dropped", async () => {
  // Regression guard: the Rust check is spawned from .setup() and Tauri's emit
  // has no replay buffer. Subscribing only after the bootstrap/auth awaits used
  // to mean an update that arrived first was lost for that whole launch.
  const app = await startWithUpdateDeps();
  assert.equal(typeof app.fire, "function", "a listener must be registered by the time start resolves");

  app.fire(AN_UPDATE);
  assert.deepEqual(app.showUpdateBannerCalls, [AN_UPDATE], "the update still reaches the banner");
});

test("dismissing the banner persists and it does not reappear on the next start", async () => {
  const storage = fakeUpdateStorage();

  const first = await startWithUpdateDeps({ updateDismissalStorage: storage });
  first.fire(AN_UPDATE);
  assert.equal(first.showUpdateBannerCalls.length, 1, "banner should appear on first start");
  first.updateBannerHandlers?.onDismiss?.();

  const second = await startWithUpdateDeps({ updateDismissalStorage: storage });
  second.fire(AN_UPDATE);

  assert.equal(second.showUpdateBannerCalls.length, 0, "dismissed version should not reappear");
});

test("clicking Install invokes the install_update command", async () => {
  const invokedCommands: string[] = [];
  const app = await startWithUpdateDeps({
    invokeTauri: async (cmd) => {
      invokedCommands.push(cmd);
      return {};
    },
  });
  app.fire(AN_UPDATE);

  await app.updateBannerHandlers?.onInstall?.();

  assert.ok(invokedCommands.includes("install_update"), "expected install_update to be invoked");
});

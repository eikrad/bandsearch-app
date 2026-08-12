const test = require("node:test");
const assert = require("node:assert/strict");
const { jsonResponse } = require("./helpers/fakeResponse");
const { fakeMediaQueryList } = require("./helpers/fakeDom");

test("startDesktopBrowserApp mounts bootstrapped react app", async () => {
  const modulePath = require.resolve("../src/index");
  const original = require(modulePath);
  const calls = [];

  require.cache[modulePath].exports = {
    ...original,
    bootstrapDesktopApp: (options) => {
      calls.push({ type: "bootstrapApp", options });
      return { mocked: true };
    },
    bootstrapDesktopReactApp: ({ app, viewport, actionHandlers }) => {
      calls.push({ type: "bootstrapReact", app, viewport, actionHandlers });
      return {
        mount: async () => {
          calls.push({ type: "mount" });
        },
      };
    },
  };

  delete require.cache[require.resolve("../src/startDesktopBrowserApp")];
  const { startDesktopBrowserApp } = require("../src/startDesktopBrowserApp");
  await startDesktopBrowserApp({
    apiBaseUrl: "http://localhost:3333",
    viewport: "mobile",
    actionHandlers: { onSave: () => {} },
  });

  require.cache[modulePath].exports = original;

  assert.equal(calls[0].type, "bootstrapApp");
  assert.equal(calls[0].options.apiBaseUrl, "http://localhost:3333");
  assert.equal(calls[1].type, "bootstrapReact");
  assert.equal(calls[1].viewport, "mobile");
  assert.equal(calls[2].type, "mount");
});

test("startDesktopBrowserApp uses the configured remote endpoint as the API base URL", async () => {
  const modulePath = require.resolve("../src/index");
  const original = require(modulePath);
  const calls = [];

  require.cache[modulePath].exports = {
    ...original,
    bootstrapDesktopApp: (options) => {
      calls.push({ type: "bootstrapApp", options });
      return { mocked: true };
    },
    bootstrapDesktopReactApp: (opts) => {
      calls.push({ type: "bootstrapReact", saveApiEndpointUrl: opts.saveApiEndpointUrl });
      return { mount: async () => { calls.push({ type: "mount" }); } };
    },
  };

  const fakeFetch = async () => (jsonResponse({ enabled: false, userCount: 0 }));

  delete require.cache[require.resolve("../src/startDesktopBrowserApp")];
  const { startDesktopBrowserApp } = require("../src/startDesktopBrowserApp");
  await startDesktopBrowserApp({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: fakeFetch,
    invokeTauri: async (cmd) => {
      if (cmd === "gemini_config_status") {
        return { hasStoredKey: true, onboardingComplete: true, apiEndpointUrl: "https://bandsearch.onrender.com" };
      }
      return {};
    },
  });

  require.cache[modulePath].exports = original;

  const appCall = calls.find((c) => c.type === "bootstrapApp");
  assert.ok(appCall, "bootstrapDesktopApp should be called");
  assert.equal(appCall.options.apiBaseUrl, "https://bandsearch.onrender.com");
  const reactCall = calls.find((c) => c.type === "bootstrapReact");
  assert.equal(typeof reactCall.saveApiEndpointUrl, "function", "should wire saveApiEndpointUrl through");
});

test("startDesktopBrowserApp picks mobile viewport when matchMedia matches narrow width", async () => {
  const modulePath = require.resolve("../src/index");
  const original = require(modulePath);
  const calls = [];

  require.cache[modulePath].exports = {
    ...original,
    bootstrapDesktopApp: () => ({ mocked: true }),
    bootstrapDesktopReactApp: ({ viewport }) => {
      calls.push({ type: "bootstrapReact", viewport });
      return {
        mount: async () => {
          calls.push({ type: "mount" });
        },
        desktopUi: { setViewport: () => {} },
      };
    },
  };

  const prevWindow = globalThis.window;
  globalThis.window = /** @type {typeof globalThis.window} */ ({
    matchMedia: (query) => fakeMediaQueryList(query.includes("max-width")),
  });

  delete require.cache[require.resolve("../src/startDesktopBrowserApp")];
  const { startDesktopBrowserApp } = require("../src/startDesktopBrowserApp");
  await startDesktopBrowserApp({ viewport: "desktop" });

  require.cache[modulePath].exports = original;
  globalThis.window = prevWindow;

  assert.equal(calls[0].type, "bootstrapReact");
  assert.equal(calls[0].viewport, "mobile");
});

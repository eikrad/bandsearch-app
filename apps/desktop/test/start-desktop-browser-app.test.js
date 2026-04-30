const test = require("node:test");
const assert = require("node:assert/strict");

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
        mount: () => calls.push({ type: "mount" }),
      };
    },
  };

  delete require.cache[require.resolve("../src/startDesktopBrowserApp")];
  const { startDesktopBrowserApp } = require("../src/startDesktopBrowserApp");
  startDesktopBrowserApp({
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

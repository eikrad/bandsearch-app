const test = require("node:test");
const assert = require("node:assert/strict");

test("bootBrowserDesktopApp forwards options to browser starter", async () => {
  const starterPath = require.resolve("../src/startDesktopBrowserApp");
  const entryPath = require.resolve("../src/browserEntry");
  const originalStarter = require(starterPath);
  const calls = [];

  require.cache[starterPath].exports = {
    ...originalStarter,
    startDesktopBrowserApp: (options) => {
      calls.push(options);
      return /** @type {any} */ (Promise.resolve({ ok: true }));
    },
  };

  delete require.cache[entryPath];
  const { bootBrowserDesktopApp } = require("../src/browserEntry");
  const result = await bootBrowserDesktopApp({ apiBaseUrl: "http://localhost:3001" });

  require.cache[starterPath].exports = originalStarter;

  assert.equal(/** @type {any} */ (result).ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].apiBaseUrl, "http://localhost:3001");
});

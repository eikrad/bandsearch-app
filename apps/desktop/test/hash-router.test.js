const test = require("node:test");
const assert = require("node:assert/strict");

const { createHashRouter } = require("../src/createHashRouter");

function createTestRouter(initialHash = "") {
  let currentHash = initialHash;
  const listeners = [];

  const router = createHashRouter({
    getHash: () => currentHash,
    setHash: (hash) => {
      currentHash = hash;
      listeners.forEach((fn) => fn({ newURL: `http://x${hash}` }));
    },
    addListener: (fn) => listeners.push(fn),
    removeListener: (fn) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  });

  return { router, getListeners: () => listeners };
}

test("createHashRouter returns home route for empty hash", () => {
  const { router } = createTestRouter("");
  assert.equal(router.getRoute(), "home");
});

test("createHashRouter returns home for hash /", () => {
  const { router } = createTestRouter("#/");
  assert.equal(router.getRoute(), "home");
});

test("createHashRouter returns saved route for hash /saved", () => {
  const { router } = createTestRouter("#/saved");
  assert.equal(router.getRoute(), "saved");
});

test("createHashRouter navigate changes route to saved", () => {
  const { router } = createTestRouter("");
  router.navigate("saved");
  assert.equal(router.getRoute(), "saved");
});

test("createHashRouter navigate changes route back to home", () => {
  const { router } = createTestRouter("#/saved");
  router.navigate("home");
  assert.equal(router.getRoute(), "home");
});

test("createHashRouter returns settings route for hash /settings", () => {
  const { router } = createTestRouter("#/settings");
  assert.equal(router.getRoute(), "settings");
});

test("createHashRouter navigate changes route to settings", () => {
  const { router } = createTestRouter("");
  router.navigate("settings");
  assert.equal(router.getRoute(), "settings");
});

test("createHashRouter fires onRouteChange callback when navigating", () => {
  const { router } = createTestRouter("");
  const changes = [];
  router.onRouteChange((route) => changes.push(route));

  router.navigate("saved");
  router.navigate("home");

  assert.equal(changes.length, 2);
  assert.equal(changes[0], "saved");
  assert.equal(changes[1], "home");
});

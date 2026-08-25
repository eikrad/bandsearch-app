import test from "node:test";
import assert from "node:assert/strict";
import { createHashRouter } from "../src/createHashRouter.js";

function createTestRouter(initialHash = "") {
  let currentHash = initialHash;
  const listeners: Array<() => void> = [];

  const router = createHashRouter({
    getHash: () => currentHash,
    setHash: (hash) => {
      currentHash = hash;
      listeners.forEach((fn) => fn());
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

test("createHashRouter returns welcome route for hash /welcome", () => {
  const { router } = createTestRouter("#/welcome");
  assert.equal(router.getRoute(), "welcome");
});

test("createHashRouter navigate changes route to welcome", () => {
  const { router } = createTestRouter("");
  router.navigate("welcome");
  assert.equal(router.getRoute(), "welcome");
});

test("createHashRouter fires onRouteChange when navigating to welcome", () => {
  const { router } = createTestRouter("");
  const changes: string[] = [];
  router.onRouteChange((route) => changes.push(route));
  router.navigate("welcome");
  assert.deepEqual(changes, ["welcome"]);
});

test("createHashRouter fires onRouteChange callback when navigating", () => {
  const { router } = createTestRouter("");
  const changes: string[] = [];
  router.onRouteChange((route) => changes.push(route));

  router.navigate("saved");
  router.navigate("home");

  assert.equal(changes.length, 2);
  assert.equal(changes[0], "saved");
  assert.equal(changes[1], "home");
});

test("a user can reach the privacy policy by URL", () => {
  const router = createHashRouter({
    getHash: () => "#/privacy",
    setHash: () => {},
    addListener: () => {},
    removeListener: () => {},
  });

  assert.equal(router.getRoute(), "privacy");
});

test("navigating to the privacy policy sets a shareable hash", () => {
  let hash = "";
  const router = createHashRouter({
    getHash: () => hash,
    setHash: (next: string) => { hash = next; },
    addListener: () => {},
    removeListener: () => {},
  });

  router.navigate("privacy");

  assert.equal(hash, "#/privacy");
});

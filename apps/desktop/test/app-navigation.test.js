const test = require("node:test");
const assert = require("node:assert/strict");

const { bootstrapDesktopApp } = require("../src");

function makeApp() {
  return bootstrapDesktopApp({ apiBaseUrl: "http://localhost:3001", fetchImpl: async () => ({}) });
}

test("bootstrapDesktopApp starts on chat view", () => {
  const app = makeApp();
  assert.equal(app.getView(), "chat");
});

test("navigate to saved-artists changes view", () => {
  const app = makeApp();
  app.navigate("saved-artists");
  assert.equal(app.getView(), "saved-artists");
});

test("navigate back to chat works", () => {
  const app = makeApp();
  app.navigate("saved-artists");
  app.navigate("chat");
  assert.equal(app.getView(), "chat");
});

test("navigate to unknown view is ignored", () => {
  const app = makeApp();
  app.navigate("unknown-view");
  assert.equal(app.getView(), "chat");
});

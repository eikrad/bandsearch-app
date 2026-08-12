import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapDesktopApp } from "../src/index.js";
import { jsonResponse } from "./helpers/fakeResponse.js";

function makeApp() {
  return bootstrapDesktopApp({ apiBaseUrl: "http://localhost:3001", fetchImpl: async () => jsonResponse({}) });
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

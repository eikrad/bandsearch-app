import test from "node:test";
import assert from "node:assert/strict";
import { fakeDesktopApp } from "./helpers/fakeApp.js";
import { bootstrapDesktopRenderAdapter } from "../src/index.js";

test("desktop render adapter bootstrap exposes initial view props", () => {
  const adapter = bootstrapDesktopRenderAdapter({
    app: fakeDesktopApp({
      requestRecommendations: async () => ({ recommendations: [], meta: { modeUsed: "fresh" } }),
      getState: () => ({ messages: [] }),
    }),
  });

  const props = adapter.getViewProps();
  assert.equal(props.headerTitle, "Bandsearch");
  assert.equal(Array.isArray(props.modeOptions), true);
});

test("desktopUi.setViewport updates view props viewport", () => {
  const adapter = bootstrapDesktopRenderAdapter({
    app: fakeDesktopApp({
      requestRecommendations: async () => ({ recommendations: [], meta: { modeUsed: "fresh" } }),
      getState: () => ({ messages: [] }),
    }),
  });

  assert.equal(adapter.getViewProps().viewport, "desktop");
  adapter.desktopUi.setViewport("mobile");
  assert.equal(adapter.getViewProps().viewport, "mobile");
});

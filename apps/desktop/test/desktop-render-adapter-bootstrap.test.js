const test = require("node:test");
const assert = require("node:assert/strict");

const { bootstrapDesktopRenderAdapter } = require("../src");

test("desktop render adapter bootstrap exposes initial view props", () => {
  const adapter = bootstrapDesktopRenderAdapter({
    app: {
      requestRecommendations: async () => ({ recommendations: [], meta: { modeUsed: "fresh" } }),
      getState: () => ({ messages: [] }),
    },
  });

  const props = adapter.getViewProps();
  assert.equal(props.headerTitle, "Bandsearch");
  assert.equal(Array.isArray(props.modeOptions), true);
});

const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");
const { createPreferenceRepository } = require("../src/preferences/preferenceRepository");

async function withServer(app, fn) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    return await fn(async (path, { method = "GET", body } = {}) => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, data: await res.json() };
    });
  } finally {
    server.close();
  }
}

function buildStack({ onRunModel }) {
  const preferenceRepository = createPreferenceRepository();
  const recommendationPipeline = {
    recommend: async ({ query, mode }) => {
      const modeUsed = mode === "preference-aware" ? "preference-aware" : "fresh";
      const preferenceContext = modeUsed === "preference-aware" ? await preferenceRepository.buildContext() : "";
      onRunModel({
        query,
        preferenceContext,
      });
      return {
        recommendations: [{ artist: "Fen", why: "spy result", sourceSignals: ["agent_reasoning"] }],
        meta: { modeUsed, usedPreferenceContext: preferenceContext.length > 0 },
      };
    },
  };
  return createApp({ preferenceRepository, recommendationPipeline });
}

test("smoke: preference-aware mode routes saved band context to the agent", async () => {
  const captured = [];
  const app = buildStack({ onRunModel: (args) => captured.push(args) });

  await withServer(app, async (req) => {
    const saved = await req("/preferences", {
      method: "POST",
      body: {
        musicbrainzArtistId: "mb-001",
        name: "Radiohead",
        rating: 5,
        categories: ["alternative", "experimental"],
        note: "All-time favourite",
      },
    });
    assert.equal(saved.status, 201, "saving band should succeed");

    const rec = await req("/recommendations", {
      method: "POST",
      body: { query: "atmospheric rock", mode: "preference-aware" },
    });

    assert.equal(rec.status, 200);
    assert.equal(rec.data.meta.modeUsed, "preference-aware");
    assert.equal(rec.data.meta.usedPreferenceContext, true);
    assert.equal(captured.length, 1, "runModel should be called once");
    assert.ok(
      captured[0].preferenceContext.includes("Radiohead"),
      `preferenceContext should mention saved band, got: "${captured[0].preferenceContext}"`,
    );
  });
});

test("smoke: fresh mode passes empty preferenceContext to the agent", async () => {
  const captured = [];
  const app = buildStack({ onRunModel: (args) => captured.push(args) });

  await withServer(app, async (req) => {
    await req("/preferences", {
      method: "POST",
      body: {
        musicbrainzArtistId: "mb-002",
        name: "Alcest",
        rating: 4,
        categories: ["blackgaze"],
        note: "",
      },
    });

    const rec = await req("/recommendations", {
      method: "POST",
      body: { query: "post black metal", mode: "fresh" },
    });

    assert.equal(rec.status, 200);
    assert.equal(rec.data.meta.modeUsed, "fresh");
    assert.equal(rec.data.meta.usedPreferenceContext, false);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].preferenceContext, "", "fresh mode must not leak saved bands to agent");
  });
});

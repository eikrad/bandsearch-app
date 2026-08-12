import { test } from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/app.js";
import { createPreferenceRepository } from "../src/preferences/preferenceRepository.js";

type ApiData = { meta: { modeUsed: string; usedPreferenceContext: boolean } };

function parseApiData(value: unknown): ApiData {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as ApiData;
}

type RequestOptions = { method?: string; body?: unknown };
type RequestResult = { status: number; data: ApiData };
type RequestFn = (path: string, options?: RequestOptions) => Promise<RequestResult>;

async function withServer<T>(app: ReturnType<typeof createApp>, fn: (request: RequestFn) => Promise<T>): Promise<T> {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  const base = `http://127.0.0.1:${port}`;

  try {
    return await fn(async (path: string, { method = "GET", body }: RequestOptions = {}) => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, data: parseApiData(await res.json()) };
    });
  } finally {
    server.close();
  }
}

type ModelArgs = { query: string; preferenceContext: string };

function buildStack({ onRunModel }: { onRunModel: (args: ModelArgs) => void }) {
  const preferenceRepository = createPreferenceRepository();
  const recommendationPipeline = {
    recommend: async (input: Record<string, unknown>) => {
      const query = typeof input.query === "string" ? input.query : "";
      const mode = input.mode;
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
  const captured: ModelArgs[] = [];
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
  const captured: ModelArgs[] = [];
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

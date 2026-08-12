import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../src/app.js";
import { createInMemoryEvalRepository } from "../../src/eval/evalRepository.js";
import { assertRecord } from "../helpers/typeAssertions.js";
import type { EvalEventContext, EvalWorker } from "../../src/eval/evalWorker.js";

function makePreferenceRepoStub() {
  return {
    addSavedBand: async () => ({ ok: true, savedBand: null }),
    listSavedBands: async () => [],
    updateSavedBand: async () => ({ ok: false, status: 404, error: "not found" }),
    deleteSavedBand: async () => ({ ok: false, status: 404, error: "not found" }),
    buildContext: async () => "",
    buildContextForIds: async () => "",
    importSavedBands: async () => ({ imported: 0, skipped: 0, failed: 0 }),
    listGroups: async () => [],
    createGroup: async () => ({ ok: false, status: 400, error: "stub" }),
    renameGroup: async () => ({ ok: false, status: 404, error: "stub" }),
    deleteGroup: async () => ({ ok: false, status: 404, error: "stub" }),
    addArtistToGroup: async () => ({ ok: false, status: 404, error: "stub" }),
    removeArtistFromGroup: async () => ({ ok: false, status: 404, error: "stub" }),
  };
}

async function makeRequest(app: ReturnType<typeof createApp>, path: string, payload: unknown) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    return { status: response.status, data };
  } finally {
    server.close();
  }
}

async function makeGetRequest(app: ReturnType<typeof createApp>, path: string) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    if (response.headers.get("content-type")?.includes("application/json")) {
      const data = await response.json();
      return { status: response.status, data };
    }
    return { status: response.status, data: null };
  } finally {
    server.close();
  }
}

const stubPipeline = {
  recommend: async () => ({
    recommendations: [{ artist: "Alcest", why: "dreamy", sourceSignals: [] }],
    assistantReply: "Here are your picks",
    meta: {
      modeUsed: "fresh",
      usedPreferenceContext: false,
      pipelineDiagnostics: {
        braveHitCount: 5,
        extractedCandidateCount: 3,
        verifiedCount: 2,
        reflectionTriggered: false,
        searchBudgetUsed: 3,
      },
    },
  }),
};

test("POST /recommendations fires evalWorker.processEvent on success", async () => {
  const calls: EvalEventContext[] = [];
  const evalWorker: EvalWorker = { processEvent: async (ctx) => { calls.push(ctx); } };
  const app = createApp({
    recommendationPipeline: stubPipeline,
    preferenceRepository: makePreferenceRepoStub(),
    evalWorker,
  });

  await makeRequest(app, "/recommendations", { query: "post-rock bands" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].query, "post-rock bands");
  assert.equal(calls[0].mode, "fresh");
  assert.ok(typeof calls[0].pipelineVersion === "string");
  assert.ok(calls[0].pipelineDiagnostics !== undefined);
  assert.equal(calls[0].pipelineDiagnostics.braveHitCount, 5);
});

test("POST /recommendations does NOT fire evalWorker.processEvent on validation error", async () => {
  const calls: EvalEventContext[] = [];
  const evalWorker: EvalWorker = { processEvent: async (ctx) => { calls.push(ctx); } };
  const app = createApp({
    preferenceRepository: makePreferenceRepoStub(),
    evalWorker,
  });

  await makeRequest(app, "/recommendations", { query: "" });

  assert.equal(calls.length, 0);
});

test("POST /recommendations does NOT expose pipelineDiagnostics in HTTP response meta", async () => {
  const app = createApp({
    recommendationPipeline: stubPipeline,
    preferenceRepository: makePreferenceRepoStub(),
  });
  const result = await makeRequest(app, "/recommendations", { query: "post-rock" });

  assert.equal(result.status, 200);
  assertRecord(result.data);
  assertRecord(result.data.meta);
  assert.ok(!("pipelineDiagnostics" in result.data.meta));
});

test("GET /eval/events returns 404 when evalDashboardEnabled is false", async () => {
  const app = createApp({
    preferenceRepository: makePreferenceRepoStub(),
    runtimeConfig: { evalDashboardEnabled: false },
  });
  const result = await makeGetRequest(app, "/eval/events");
  assert.equal(result.status, 404);
});

test("GET /eval/events returns event list when evalDashboardEnabled is true", async () => {
  const repo = createInMemoryEvalRepository();
  const app = createApp({
    preferenceRepository: makePreferenceRepoStub(),
    evalRepository: repo,
    runtimeConfig: { evalDashboardEnabled: true },
  });
  const result = await makeGetRequest(app, "/eval/events");
  assert.equal(result.status, 200);
  assertRecord(result.data);
  assert.ok(Array.isArray(result.data.events));
});

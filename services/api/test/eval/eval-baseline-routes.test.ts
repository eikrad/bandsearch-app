import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../src/app.js";
import { createInMemoryEvalRepository } from "../../src/eval/evalRepository.js";
import { assertArray, assertRecord } from "../helpers/typeAssertions.js";

function makePreferenceRepoStub() {
  return {
    addSavedBand: async () => ({ ok: true, savedBand: null }),
    listSavedBands: async () => [],
    updateSavedBand: async () => ({ ok: false, status: 404, error: "not found" }),
    deleteSavedBand: async () => ({ ok: false, status: 404, error: "not found" }),
    importSavedBands: async () => ({ imported: 0, skipped: 0, failed: 0 }),
    listGroups: async () => [],
    createGroup: async () => ({ ok: false, status: 400, error: "stub" }),
    renameGroup: async () => ({ ok: false, status: 404, error: "stub" }),
    deleteGroup: async () => ({ ok: false, status: 404, error: "stub" }),
    addArtistToGroup: async () => ({ ok: false, status: 404, error: "stub" }),
    removeArtistFromGroup: async () => ({ ok: false, status: 404, error: "stub" }),
  };
}

async function startServer(app: ReturnType<typeof createApp>) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;
  return { server, baseUrl };
}

async function makeRequest(baseUrl: string, method: string, path: string, payload?: unknown) {
  const opts: RequestInit = {
    method,
    headers: { "content-type": "application/json" },
  };
  if (payload !== undefined) opts.body = JSON.stringify(payload);
  const response = await fetch(`${baseUrl}${path}`, opts);
  let data: unknown = null;
  const ct = response.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) data = await response.json();
  return { status: response.status, data };
}

// ─── /eval/baselines ──────────────────────────────────────────────────────────

test("GET /eval/baselines returns 404 when dashboard disabled", async () => {
  const app = createApp({
    preferenceRepository: makePreferenceRepoStub(),
    runtimeConfig: { evalDashboardEnabled: false },
  });
  const { server, baseUrl } = await startServer(app);
  try {
    const result = await makeRequest(baseUrl, "GET", "/eval/baselines");
    assert.equal(result.status, 404);
  } finally {
    server.close();
  }
});

test("GET /eval/baselines returns empty array when no baselines exist", async () => {
  const repo = createInMemoryEvalRepository();
  const app = createApp({
    preferenceRepository: makePreferenceRepoStub(),
    evalRepository: repo,
    runtimeConfig: { evalDashboardEnabled: true },
  });
  const { server, baseUrl } = await startServer(app);
  try {
    const result = await makeRequest(baseUrl, "GET", "/eval/baselines");
    assert.equal(result.status, 200);
    assertRecord(result.data);
    assertArray(result.data.baselines);
    assert.equal(result.data.baselines.length, 0);
  } finally {
    server.close();
  }
});

// ─── POST /eval/baseline ──────────────────────────────────────────────────────

test("POST /eval/baseline returns 404 when dashboard disabled", async () => {
  const app = createApp({
    preferenceRepository: makePreferenceRepoStub(),
    runtimeConfig: { evalDashboardEnabled: false },
  });
  const { server, baseUrl } = await startServer(app);
  try {
    const result = await makeRequest(baseUrl, "POST", "/eval/baseline", { label: "v1" });
    assert.equal(result.status, 404);
  } finally {
    server.close();
  }
});

test("POST /eval/baseline returns 400 when label is missing", async () => {
  const repo = createInMemoryEvalRepository();
  const app = createApp({
    preferenceRepository: makePreferenceRepoStub(),
    evalRepository: repo,
    runtimeConfig: { evalDashboardEnabled: true },
  });
  const { server, baseUrl } = await startServer(app);
  try {
    const result = await makeRequest(baseUrl, "POST", "/eval/baseline", {});
    assert.equal(result.status, 400);
  } finally {
    server.close();
  }
});

test("POST /eval/baseline creates a baseline and returns id + label + createdAt", async () => {
  const repo = createInMemoryEvalRepository();
  const app = createApp({
    preferenceRepository: makePreferenceRepoStub(),
    evalRepository: repo,
    runtimeConfig: { evalDashboardEnabled: true },
  });
  const { server, baseUrl } = await startServer(app);
  try {
    const result = await makeRequest(baseUrl, "POST", "/eval/baseline", { label: "initial" });
    assert.equal(result.status, 201);
    assertRecord(result.data);
    assert.ok(typeof result.data.id === "string" && result.data.id.length > 0);
    assert.equal(result.data.label, "initial");
    assert.ok(typeof result.data.createdAt === "string");
  } finally {
    server.close();
  }
});

test("GET /eval/baselines lists created baselines", async () => {
  const repo = createInMemoryEvalRepository();
  const app = createApp({
    preferenceRepository: makePreferenceRepoStub(),
    evalRepository: repo,
    runtimeConfig: { evalDashboardEnabled: true },
  });
  const { server, baseUrl } = await startServer(app);
  try {
    await makeRequest(baseUrl, "POST", "/eval/baseline", { label: "v1" });
    await makeRequest(baseUrl, "POST", "/eval/baseline", { label: "v2" });
    const result = await makeRequest(baseUrl, "GET", "/eval/baselines");
    assert.equal(result.status, 200);
    assertRecord(result.data);
    assertArray(result.data.baselines);
    assert.equal(result.data.baselines.length, 2);
    const labels = result.data.baselines.map((baseline) => {
      assertRecord(baseline);
      assert.ok(typeof baseline.label === "string");
      return baseline.label;
    });
    assert.ok(labels.includes("v1"));
    assert.ok(labels.includes("v2"));
  } finally {
    server.close();
  }
});

// ─── GET /eval/metrics ────────────────────────────────────────────────────────

test("GET /eval/metrics returns 404 when dashboard disabled", async () => {
  const app = createApp({
    preferenceRepository: makePreferenceRepoStub(),
    runtimeConfig: { evalDashboardEnabled: false },
  });
  const { server, baseUrl } = await startServer(app);
  try {
    const result = await makeRequest(baseUrl, "GET", "/eval/metrics");
    assert.equal(result.status, 404);
  } finally {
    server.close();
  }
});

test("GET /eval/metrics returns current metrics with null baseline and delta when no baseline", async () => {
  const repo = createInMemoryEvalRepository();
  const app = createApp({
    preferenceRepository: makePreferenceRepoStub(),
    evalRepository: repo,
    runtimeConfig: { evalDashboardEnabled: true },
  });
  const { server, baseUrl } = await startServer(app);
  try {
    const result = await makeRequest(baseUrl, "GET", "/eval/metrics");
    assert.equal(result.status, 200);
    assertRecord(result.data);
    assert.ok("current" in result.data);
    assert.equal(result.data.baseline, null);
    assert.equal(result.data.delta, null);
  } finally {
    server.close();
  }
});

test("GET /eval/metrics returns delta against latest baseline", async () => {
  const repo = createInMemoryEvalRepository();
  // Snapshot a baseline first (empty data)
  const app = createApp({
    preferenceRepository: makePreferenceRepoStub(),
    evalRepository: repo,
    runtimeConfig: { evalDashboardEnabled: true },
  });
  const { server, baseUrl } = await startServer(app);
  try {
    await makeRequest(baseUrl, "POST", "/eval/baseline", { label: "empty-baseline" });
    const result = await makeRequest(baseUrl, "GET", "/eval/metrics");
    assert.equal(result.status, 200);
    assertRecord(result.data);
    assert.ok(result.data.baseline !== null);
    assertRecord(result.data.baseline);
    assert.ok(result.data.delta !== null);
    assert.equal(result.data.baseline.label, "empty-baseline");
  } finally {
    server.close();
  }
});

// ─── GET /eval/events embeds bandScores ───────────────────────────────────────

test("GET /eval/events embeds bandScores per event", async () => {
  const repo = createInMemoryEvalRepository();
  const eventId = await repo.logEvent({
    query: "blackgaze",
    mode: "fresh",
    pipelineVersion: "0.4.0",
    pipelineDiagnostics: { braveHitCount: 3, extractedCandidateCount: 2, verifiedCount: 1, reflectionTriggered: false, searchBudgetUsed: 2 },
    recommendationCount: 1,
  });
  await repo.upsertBandEvalScore({ eventId, bandName: "Alcest", listeners: 50000, obscurityTier: "cult" });

  const app = createApp({
    preferenceRepository: makePreferenceRepoStub(),
    evalRepository: repo,
    runtimeConfig: { evalDashboardEnabled: true },
  });
  const { server, baseUrl } = await startServer(app);
  try {
    const result = await makeRequest(baseUrl, "GET", "/eval/events");
    assert.equal(result.status, 200);
    assertRecord(result.data);
    assertArray(result.data.events);
    assert.equal(result.data.events.length, 1);
    const event = result.data.events[0];
    assertRecord(event);
    assertArray(event.bandScores);
    assert.equal(event.bandScores.length, 1);
    const bandScore = event.bandScores[0];
    assertRecord(bandScore);
    assert.equal(bandScore.bandName, "Alcest");
  } finally {
    server.close();
  }
});

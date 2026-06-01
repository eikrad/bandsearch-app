const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../../src/app");
const { createInMemoryEvalRepository } = require("../../src/eval/evalRepository");

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

async function startServer(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function makeRequest(baseUrl, method, path, payload) {
  const opts = { method, headers: { "content-type": "application/json" } };
  if (payload !== undefined) opts.body = JSON.stringify(payload);
  const response = await fetch(`${baseUrl}${path}`, opts);
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

test("POST /eval/feedback returns 404 when dashboard disabled", async () => {
  const app = createApp({
    preferenceRepository: makePreferenceRepoStub(),
    runtimeConfig: { evalDashboardEnabled: false },
  });
  const { server, baseUrl } = await startServer(app);
  try {
    const result = await makeRequest(baseUrl, "POST", "/eval/feedback", {
      eventId: "evt-1",
      feedbackType: "good",
    });
    assert.equal(result.status, 404);
  } finally {
    server.close();
  }
});

test("POST /eval/feedback stores feedback and returns ok:true", async () => {
  const repo = createInMemoryEvalRepository();
  const eventId = await repo.logEvent({
    query: "blackgaze bands",
    mode: "fresh",
    pipelineVersion: "0.4.0",
    pipelineDiagnostics: { braveHitCount: 1, extractedCandidateCount: 1, verifiedCount: 1, reflectionTriggered: false, searchBudgetUsed: 1 },
    recommendationCount: 1,
  });

  const app = createApp({
    preferenceRepository: makePreferenceRepoStub(),
    evalRepository: repo,
    runtimeConfig: { evalDashboardEnabled: true },
  });
  const { server, baseUrl } = await startServer(app);
  try {
    const result = await makeRequest(baseUrl, "POST", "/eval/feedback", {
      eventId,
      feedbackType: "good",
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.ok, true);
  } finally {
    server.close();
  }
});

test("POST /eval/feedback returns 400 on invalid feedbackType", async () => {
  const repo = createInMemoryEvalRepository();
  const app = createApp({
    preferenceRepository: makePreferenceRepoStub(),
    evalRepository: repo,
    runtimeConfig: { evalDashboardEnabled: true },
  });
  const { server, baseUrl } = await startServer(app);
  try {
    const result = await makeRequest(baseUrl, "POST", "/eval/feedback", {
      eventId: "evt-1",
      feedbackType: "awesome",
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.error.code, "validation_error");
  } finally {
    server.close();
  }
});

test("POST /eval/feedback returns 400 when eventId is missing", async () => {
  const repo = createInMemoryEvalRepository();
  const app = createApp({
    preferenceRepository: makePreferenceRepoStub(),
    evalRepository: repo,
    runtimeConfig: { evalDashboardEnabled: true },
  });
  const { server, baseUrl } = await startServer(app);
  try {
    const result = await makeRequest(baseUrl, "POST", "/eval/feedback", {
      feedbackType: "good",
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.error.code, "validation_error");
  } finally {
    server.close();
  }
});

test("POST /eval/feedback accepts all valid feedback types", async () => {
  const repo = createInMemoryEvalRepository();
  const app = createApp({
    preferenceRepository: makePreferenceRepoStub(),
    evalRepository: repo,
    runtimeConfig: { evalDashboardEnabled: true },
  });
  const { server, baseUrl } = await startServer(app);
  try {
    for (const feedbackType of ["good", "too_mainstream", "wrong_direction"]) {
      const result = await makeRequest(baseUrl, "POST", "/eval/feedback", {
        eventId: `evt-${feedbackType}`,
        feedbackType,
      });
      assert.equal(result.status, 200, `expected 200 for feedbackType=${feedbackType}`);
    }
  } finally {
    server.close();
  }
});

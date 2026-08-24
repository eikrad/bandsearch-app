import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../src/app.js";
import { createInMemoryEvalRepository } from "../../src/eval/evalRepository.js";
import type { AddressInfo } from "node:net";

function makePreferenceRepoStub() {
  return {
    addSavedBand: async () => ({ ok: true as const, savedBand: null }),
    listSavedBands: async () => [],
    updateSavedBand: async () => ({ ok: false as const, status: 404, error: "not found" }),
    deleteSavedBand: async () => ({ ok: false as const, status: 404, error: "not found" }),
    importSavedBands: async () => ({ imported: 0, skipped: 0, failed: 0 }),
    listGroups: async () => [],
    createGroup: async () => ({ ok: false as const, status: 400, error: "stub" }),
    renameGroup: async () => ({ ok: false as const, status: 404, error: "stub" }),
    deleteGroup: async () => ({ ok: false as const, status: 404, error: "stub" }),
    addArtistToGroup: async () => ({ ok: false as const, status: 404, error: "stub" }),
    removeArtistFromGroup: async () => ({ ok: false as const, status: 404, error: "stub" }),
  };
}

async function startServer(app: ReturnType<typeof createApp>) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function getDashboard(baseUrl: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}/eval/dashboard`, { headers });
  const body = await res.text();
  return { status: res.status, contentType: res.headers.get("content-type") ?? "", wwwAuth: res.headers.get("www-authenticate") ?? "", body };
}

describe("GET /eval/dashboard", () => {
  it("returns 404 when evalDashboardEnabled is false", async () => {
    const app = createApp({
      preferenceRepository: makePreferenceRepoStub(),
      runtimeConfig: { evalDashboardEnabled: false },
    });
    const { server, baseUrl } = await startServer(app);
    try {
      const { status } = await getDashboard(baseUrl);
      assert.equal(status, 404);
    } finally {
      server.close();
    }
  });

  it("returns 200 HTML when enabled with no password", async () => {
    const app = createApp({
      preferenceRepository: makePreferenceRepoStub(),
      evalRepository: createInMemoryEvalRepository(),
      runtimeConfig: { evalDashboardEnabled: true },
    });
    const { server, baseUrl } = await startServer(app);
    try {
      const { status, contentType, body } = await getDashboard(baseUrl);
      assert.equal(status, 200);
      assert.ok(contentType.includes("text/html"), `expected text/html, got ${contentType}`);
      assert.ok(body.includes("<!DOCTYPE html>") || body.includes("<html"), "response should contain HTML");
    } finally {
      server.close();
    }
  });

  it("returns 401 with WWW-Authenticate when password set and no auth header", async () => {
    const app = createApp({
      preferenceRepository: makePreferenceRepoStub(),
      evalRepository: createInMemoryEvalRepository(),
      runtimeConfig: { evalDashboardEnabled: true, evalDashboardPassword: "secret" },
    });
    const { server, baseUrl } = await startServer(app);
    try {
      const { status, wwwAuth } = await getDashboard(baseUrl);
      assert.equal(status, 401);
      assert.ok(wwwAuth.includes("Basic"), `expected Basic auth challenge, got: ${wwwAuth}`);
    } finally {
      server.close();
    }
  });

  it("returns 200 with correct Basic Auth credentials", async () => {
    const app = createApp({
      preferenceRepository: makePreferenceRepoStub(),
      evalRepository: createInMemoryEvalRepository(),
      runtimeConfig: { evalDashboardEnabled: true, evalDashboardPassword: "secret" },
    });
    const { server, baseUrl } = await startServer(app);
    try {
      const creds = Buffer.from("eval:secret").toString("base64");
      const { status, contentType } = await getDashboard(baseUrl, { Authorization: `Basic ${creds}` });
      assert.equal(status, 200);
      assert.ok(contentType.includes("text/html"), `expected text/html, got ${contentType}`);
    } finally {
      server.close();
    }
  });
});

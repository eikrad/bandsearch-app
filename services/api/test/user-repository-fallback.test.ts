import test from "node:test";
import assert from "node:assert/strict";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { assertRecord } from "./helpers/typeAssertions.js";

function makePrefStub() {
  return {
    addSavedBand: async () => ({ ok: true, savedBand: null }),
    listSavedBands: async () => [],
    updateSavedBand: async () => ({ ok: false, status: 404, error: "nf" }),
    deleteSavedBand: async () => ({ ok: false, status: 404, error: "nf" }),
    importSavedBands: async () => ({ imported: 0, skipped: 0, failed: 0 }),
    listGroups: async () => [],
    createGroup: async () => ({ ok: false, status: 400, error: "stub" }),
    renameGroup: async () => ({ ok: false, status: 404, error: "stub" }),
    deleteGroup: async () => ({ ok: false, status: 404, error: "stub" }),
    addArtistToGroup: async () => ({ ok: false, status: 404, error: "stub" }),
    removeArtistFromGroup: async () => ({ ok: false, status: 404, error: "stub" }),
  };
}

async function makeRequest(app: ReturnType<typeof createApp>, method: string, path: string, payload?: unknown) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: payload !== undefined ? { "content-type": "application/json" } : undefined,
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
    const data = await response.json();
    return { status: response.status, data };
  } finally {
    server.close();
  }
}

async function makeGetRequest(app: Express, path: string) {
  return makeRequest(app, "GET", path);
}

// Regression: when no userRepository is injected and auth is enabled, the
// default in-memory fallback must be an actual UserRepository (with countUsers,
// findByEmail, create, ...), not a chat-session repository. GET /auth/status
// calls getStatus() -> userRepository.countUsers(), which only exists on a real
// user repository.
test("auth status works with the default in-memory user repository fallback", async () => {
  const app = createApp({
    runtimeConfig: { jwtSecret: "test-secret", databasePath: ":memory:" },
    preferenceRepository: makePrefStub(),
  });

  const result = await makeGetRequest(app, "/auth/status");

  assert.equal(result.status, 200);
  assertRecord(result.data);
  assert.equal(result.data.enabled, true);
  assert.equal(result.data.userCount, 0);
});

// Register exercises userRepository.create + findByEmail + countUsers — methods
// that only exist on a real user repository. A chat-session repo fallback would
// fail here, catching the wrong-factory regression directly.
test("register + status round-trips through the default user repository fallback", async () => {
  const app = createApp({
    runtimeConfig: { jwtSecret: "test-secret", databasePath: ":memory:" },
    preferenceRepository: makePrefStub(),
  });

  const reg = await makeRequest(app, "POST", "/auth/register", {
    email: "fan@example.com",
    displayName: "Fan",
    password: "supersecret123",
  });
  assert.equal(reg.status, 201);
  assertRecord(reg.data);
  assertRecord(reg.data.user);
  assert.equal(reg.data.user.email, "fan@example.com");

  const status = await makeGetRequest(app, "/auth/status");
  assertRecord(status.data);
  assert.equal(status.data.userCount, 1);
});

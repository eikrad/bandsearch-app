import { test } from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/app.js";

function asRecord(value: unknown): asserts value is Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  assert.ok(typeof value === "string");
  return value;
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  asRecord(value);
  return value;
}

async function makeRequest(app: ReturnType<typeof createApp>, path: string) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    const data: unknown = await response.json();
    asRecord(data);
    return { status: response.status, data };
  } finally {
    server.close();
  }
}

test("GET /health returns ok status", async () => {
  const app = createApp();
  const result = await makeRequest(app, "/health");

  assert.equal(result.status, 200);
  assert.equal(stringField(result.data, "status"), "ok");
});

test("GET /version returns app version", async () => {
  const app = createApp();
  const result = await makeRequest(app, "/version");

  assert.equal(result.status, 200);
  assert.equal(stringField(result.data, "version").length > 0, true);
});

test("GET unknown route returns structured 404 error", async () => {
  const app = createApp();
  const result = await makeRequest(app, "/missing-route");

  assert.equal(result.status, 404);
  const error = recordField(result.data, "error");
  assert.equal(stringField(error, "code"), "not_found");
  assert.equal(stringField(error, "message").includes("/missing-route"), true);
});

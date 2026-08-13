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

function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  assert.ok(Array.isArray(value));
  return value;
}

async function makeRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  { method = "GET", body }: { method?: string; body?: unknown } = {},
) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  try {
    const options: RequestInit = { method, headers: { "content-type": "application/json" } };
    if (body !== undefined) options.body = JSON.stringify(body);
    const response = await fetch(`http://127.0.0.1:${port}${path}`, options);
    const data: unknown = await response.json();
    asRecord(data);
    return { status: response.status, data };
  } finally {
    server.close();
  }
}

test("POST /sessions creates a new chat session", async () => {
  const app = createApp();
  const result = await makeRequest(app, "/sessions", {
    method: "POST",
    body: { title: "Post-black exploration" },
  });

  assert.equal(result.status, 201);
  const session = recordField(result.data, "session");
  stringField(session, "id");
  assert.equal(stringField(session, "title"), "Post-black exploration");
  stringField(session, "createdAt");
});

test("GET /sessions returns list of sessions", async () => {
  const app = createApp();
  // Create a session first
  await makeRequest(app, "/sessions", { method: "POST", body: { title: "Test session" } });

  const result = await makeRequest(app, "/sessions");
  assert.equal(result.status, 200);
  assert.equal(arrayField(result.data, "sessions").length >= 1, true);
});

test("POST /sessions/:id/messages appends a message to session", async () => {
  const app = createApp();
  const created = await makeRequest(app, "/sessions", {
    method: "POST",
    body: { title: "Test" },
  });
  const sessionId = stringField(recordField(created.data, "session"), "id");

  const result = await makeRequest(app, `/sessions/${sessionId}/messages`, {
    method: "POST",
    body: { role: "user", content: "I like atmospheric black metal" },
  });

  assert.equal(result.status, 201);
  const message = recordField(result.data, "message");
  stringField(message, "id");
  assert.equal(stringField(message, "role"), "user");
  assert.equal(stringField(message, "content"), "I like atmospheric black metal");
});

test("GET /sessions/:id returns session with messages", async () => {
  const app = createApp();
  const created = await makeRequest(app, "/sessions", {
    method: "POST",
    body: { title: "My chat" },
  });
  const sessionId = stringField(recordField(created.data, "session"), "id");

  await makeRequest(app, `/sessions/${sessionId}/messages`, {
    method: "POST",
    body: { role: "user", content: "I like Alcest" },
  });

  const result = await makeRequest(app, `/sessions/${sessionId}`);
  assert.equal(result.status, 200);
  assert.equal(stringField(recordField(result.data, "session"), "id"), sessionId);
  const messages = arrayField(result.data, "messages");
  assert.equal(messages.length, 1);
  const message = messages[0];
  asRecord(message);
  assert.equal(stringField(message, "content"), "I like Alcest");
});

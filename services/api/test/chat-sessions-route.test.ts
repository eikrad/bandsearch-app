import { test } from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/app.js";

type Session = { id: string; title: string; createdAt: string };
type Message = { id: string; role: string; content: string };
type ApiData = { session: Session; sessions: Session[]; message: Message; messages: Message[] };

function parseApiData(value: unknown): ApiData {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as ApiData;
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
    const data = parseApiData(await response.json());
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
  assert.equal(typeof result.data.session.id, "string");
  assert.equal(result.data.session.title, "Post-black exploration");
  assert.equal(typeof result.data.session.createdAt, "string");
});

test("GET /sessions returns list of sessions", async () => {
  const app = createApp();
  // Create a session first
  await makeRequest(app, "/sessions", { method: "POST", body: { title: "Test session" } });

  const result = await makeRequest(app, "/sessions");
  assert.equal(result.status, 200);
  assert.equal(Array.isArray(result.data.sessions), true);
  assert.equal(result.data.sessions.length >= 1, true);
});

test("POST /sessions/:id/messages appends a message to session", async () => {
  const app = createApp();
  const created = await makeRequest(app, "/sessions", {
    method: "POST",
    body: { title: "Test" },
  });
  const sessionId = created.data.session.id;

  const result = await makeRequest(app, `/sessions/${sessionId}/messages`, {
    method: "POST",
    body: { role: "user", content: "I like atmospheric black metal" },
  });

  assert.equal(result.status, 201);
  assert.equal(typeof result.data.message.id, "string");
  assert.equal(result.data.message.role, "user");
  assert.equal(result.data.message.content, "I like atmospheric black metal");
});

test("GET /sessions/:id returns session with messages", async () => {
  const app = createApp();
  const created = await makeRequest(app, "/sessions", {
    method: "POST",
    body: { title: "My chat" },
  });
  const sessionId = created.data.session.id;

  await makeRequest(app, `/sessions/${sessionId}/messages`, {
    method: "POST",
    body: { role: "user", content: "I like Alcest" },
  });

  const result = await makeRequest(app, `/sessions/${sessionId}`);
  assert.equal(result.status, 200);
  assert.equal(result.data.session.id, sessionId);
  assert.equal(Array.isArray(result.data.messages), true);
  assert.equal(result.data.messages.length, 1);
  assert.equal(result.data.messages[0].content, "I like Alcest");
});

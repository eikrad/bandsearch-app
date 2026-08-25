import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import { createApp } from "../src/app.js";
import { createInMemoryUserRepository, createSqliteUserRepository } from "../src/auth/userRepository.js";
import { createPreferenceRepository } from "../src/preferences/preferenceRepository.js";
import { createSqliteUserDataStore } from "../src/privacy/userDataStore.js";

const JWT_SECRET = "test-secret-at-least-32-chars-long!!";
const SCHEMA_PATH = path.join(__dirname, "..", "migrations", "002_full_schema.sql");

function asRecord(value: unknown): asserts value is Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  assert.ok(typeof value === "string", `${key} must be a string`);
  return value;
}

/** An app backed by a real in-memory SQLite database with the production schema. */
function freshApp() {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));
  const app = createApp({
    userRepository: createSqliteUserRepository({ db }),
    userDataStore: createSqliteUserDataStore({ db }),
    preferenceRepository: createPreferenceRepository({ preferenceStore: "memory" }),
    runtimeConfig: { jwtSecret: JWT_SECRET },
  });
  return { app, db };
}

async function req(
  app: ReturnType<typeof createApp>,
  method: string,
  path: string,
  payload?: unknown,
  token?: string,
) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers["authorization"] = `Bearer ${token}`;
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const raw = await response.text();
    const data: unknown = raw ? JSON.parse(raw) : {};
    asRecord(data);
    return { status: response.status, data, headers: response.headers };
  } finally {
    server.close();
  }
}

async function registerUser(app: ReturnType<typeof createApp>, email: string, password = "pw") {
  const r = await req(app, "POST", "/auth/register", { email, displayName: "Someone", password });
  assert.equal(r.status, 201, "registration succeeded");
  return stringField(r.data, "token");
}

test("a user can delete their account and all of their data is gone", async () => {
  const { app, db } = freshApp();
  const token = await registerUser(app, "one@example.com");
  const userId = (db.prepare("SELECT id FROM users LIMIT 1").get() as { id: string }).id;
  db.prepare(
    "INSERT INTO saved_bands (id, user_id, musicbrainz_artist_id, name, rating, categories, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run("sb-1", userId, "mb-1", "Alcest", 5, "[]", "", "2026-01-01", "2026-01-01");

  const r = await req(app, "POST", "/account/delete", { password: "pw" }, token);

  assert.equal(r.status, 200);
  const users = db.prepare("SELECT COUNT(*) n FROM users").get() as { n: number };
  const bands = db.prepare("SELECT COUNT(*) n FROM saved_bands WHERE user_id = ?").get(userId) as { n: number };
  assert.equal(users.n, 0, "the account is gone");
  assert.equal(bands.n, 0, "their saved bands went with it");
});

test("a wrong password deletes nothing", async () => {
  const { app, db } = freshApp();
  const token = await registerUser(app, "one@example.com");

  const r = await req(app, "POST", "/account/delete", { password: "not-my-password" }, token);

  assert.equal(r.status, 401);
  const users = db.prepare("SELECT COUNT(*) n FROM users").get() as { n: number };
  assert.equal(users.n, 1, "the account survives a wrong password");
});

test("deleting an account requires a password", async () => {
  const { app, db } = freshApp();
  const token = await registerUser(app, "one@example.com");

  const r = await req(app, "POST", "/account/delete", {}, token);

  assert.equal(r.status, 400);
  const users = db.prepare("SELECT COUNT(*) n FROM users").get() as { n: number };
  assert.equal(users.n, 1);
});

test("another user's account cannot be deleted with your own token", async () => {
  const { app, db } = freshApp();
  await registerUser(app, "one@example.com", "pw-one");
  const secondToken = await registerUser(app, "two@example.com", "pw-two");

  // The second user's own password, but it can only ever erase their own row.
  const r = await req(app, "POST", "/account/delete", { password: "pw-two" }, secondToken);

  assert.equal(r.status, 200);
  const remaining = db.prepare("SELECT email FROM users").all() as { email: string }[];
  assert.deepEqual(remaining.map((u) => u.email), ["one@example.com"], "only the caller's account was erased");
});

test("deleting the only account returns the install to first-run", async () => {
  const { app } = freshApp();
  const token = await registerUser(app, "one@example.com");

  await req(app, "POST", "/account/delete", { password: "pw" }, token);
  const status = await req(app, "GET", "/auth/status");

  assert.equal(status.data.userCount, 0, "a fresh install sees zero users again");
});

test("a user can download everything the app holds about them", async () => {
  const { app, db } = freshApp();
  const token = await registerUser(app, "one@example.com");
  const userId = (db.prepare("SELECT id FROM users LIMIT 1").get() as { id: string }).id;
  db.prepare("INSERT INTO chat_sessions (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("cs-1", userId, "Session", "2026-01-01", "2026-01-01");
  db.prepare("INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)")
    .run("m-1", "cs-1", "user", "bands like Alcest", "2026-01-01");

  const r = await req(app, "GET", "/account/export", undefined, token);

  assert.equal(r.status, 200);
  const sessions = r.data.chatSessions;
  assert.ok(Array.isArray(sessions) && sessions.length === 1, "chat history is included, not just saved bands");
  assert.equal(stringField(r.data, "format"), "bandsearch-account-export/1");
});

test("the export is offered as a file download", async () => {
  const { app } = freshApp();
  const token = await registerUser(app, "one@example.com");

  const r = await req(app, "GET", "/account/export", undefined, token);

  assert.match(
    r.headers.get("content-disposition") ?? "",
    /attachment; filename="bandsearch-account-data\.json"/,
    "the browser is told to save it",
  );
});

test("account deletion reports unavailable when no store is configured", async () => {
  const app = createApp({
    userRepository: createInMemoryUserRepository(),
    preferenceRepository: createPreferenceRepository({ preferenceStore: "memory" }),
    runtimeConfig: { jwtSecret: JWT_SECRET, preferenceStore: "memory" },
  });
  const token = await registerUser(app, "one@example.com");

  const r = await req(app, "POST", "/account/delete", { password: "pw" }, token);

  assert.equal(r.status, 503, "an erasure that cannot erase says so rather than reporting success");
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { createSqliteUserDataStore, USER_SCOPED_TABLES, rowToSavedBand } from "../src/privacy/userDataStore.js";

const SCHEMA_PATH = path.join(__dirname, "..", "migrations", "002_full_schema.sql");

type PragmaTableRow = { name: string };
type SqliteMasterRow = { name: string };

/** A database with the real production schema and two users' worth of data. */
function seededDb() {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));

  const now = new Date().toISOString();
  for (const [id, email] of [["u-1", "one@example.com"], ["u-2", "two@example.com"]]) {
    db.prepare(
      "INSERT INTO users (id, email, display_name, password_hash, recovery_code_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, email, "Someone", "hash", "recovery-hash", now);
    db.prepare(
      "INSERT INTO saved_bands (id, user_id, musicbrainz_artist_id, name, rating, categories, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(`sb-${id}`, id, "mb-1", "Alcest", 5, "[]", "lovely", now, now);
    db.prepare("INSERT INTO artist_groups (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(`g-${id}`, id, "Blackgaze", now, now);
    db.prepare("INSERT INTO artist_group_members (group_id, saved_band_id, added_at) VALUES (?, ?, ?)")
      .run(`g-${id}`, `sb-${id}`, now);
    db.prepare("INSERT INTO chat_sessions (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(`cs-${id}`, id, "Session", now, now);
    db.prepare("INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(`m-${id}`, `cs-${id}`, "user", "bands like Alcest", now);
    db.prepare(
      "INSERT INTO recommendation_events (id, query, mode, pipeline_version, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(`ev-${id}`, "post-black metal", "fresh", "0.0.0-test", now);
    db.prepare(
      "INSERT INTO recommendation_feedback (id, event_id, user_id, feedback_type, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(`f-${id}`, `ev-${id}`, id, "good", now);
  }
  return db;
}

function rowCountFor(db: import("better-sqlite3").Database, userId: string): number {
  const counts = [
    db.prepare("SELECT COUNT(*) n FROM users WHERE id = ?").get(userId),
    db.prepare("SELECT COUNT(*) n FROM saved_bands WHERE user_id = ?").get(userId),
    db.prepare("SELECT COUNT(*) n FROM artist_groups WHERE user_id = ?").get(userId),
    db.prepare("SELECT COUNT(*) n FROM chat_sessions WHERE user_id = ?").get(userId),
    db.prepare("SELECT COUNT(*) n FROM recommendation_feedback WHERE user_id = ?").get(userId),
    db.prepare("SELECT COUNT(*) n FROM chat_messages WHERE session_id = ?").get(`cs-${userId}`),
    db
      .prepare("SELECT COUNT(*) n FROM artist_group_members WHERE group_id = ? OR saved_band_id = ?")
      .get(`g-${userId}`, `sb-${userId}`),
  ] as { n: number }[];
  return counts.reduce((sum, row) => sum + row.n, 0);
}

test("erasing a user removes every trace of them from every table", async () => {
  const db = seededDb();
  const store = createSqliteUserDataStore({ db });

  assert.ok(rowCountFor(db, "u-1") > 0, "fixture actually seeded data for u-1");
  await store.eraseUserData("u-1");

  assert.equal(rowCountFor(db, "u-1"), 0, "no row anywhere still references the erased user");
});

test("erasing a user leaves another user's data untouched", async () => {
  const db = seededDb();
  const store = createSqliteUserDataStore({ db });
  const before = rowCountFor(db, "u-2");

  await store.eraseUserData("u-1");

  assert.equal(rowCountFor(db, "u-2"), before, "the other user keeps all of their data");
});

test("erasing a user removes their group memberships even without foreign keys enabled", async () => {
  const db = seededDb();
  db.pragma("foreign_keys = OFF");
  const store = createSqliteUserDataStore({ db });

  await store.eraseUserData("u-1");

  const members = db
    .prepare("SELECT COUNT(*) n FROM artist_group_members WHERE group_id = ? OR saved_band_id = ?")
    .get("g-u-1", "sb-u-1") as { n: number };
  assert.equal(members.n, 0, "memberships are deleted explicitly, never left to cascade");
});

test("every table that stores a user_id is covered by account erasure", () => {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as SqliteMasterRow[];

  const covered = new Set(USER_SCOPED_TABLES.map((t) => t.table));
  for (const { name } of tables) {
    const columns = db.prepare(`PRAGMA table_info(${name})`).all() as PragmaTableRow[];
    if (!columns.some((c) => c.name === "user_id")) continue;
    assert.ok(
      covered.has(name),
      `${name} stores a user_id but is not in USER_SCOPED_TABLES — account erasure would leave it behind`,
    );
  }
});

test("erasure succeeds on a database where the eval tables were never created", async () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, display_name TEXT,
      password_hash TEXT, recovery_code_hash TEXT, created_at TEXT);
    CREATE TABLE saved_bands (id TEXT PRIMARY KEY, user_id TEXT, musicbrainz_artist_id TEXT,
      name TEXT, rating INTEGER, categories TEXT, note TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE artist_groups (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE artist_group_members (group_id TEXT, saved_band_id TEXT, added_at TEXT);
    CREATE TABLE chat_sessions (id TEXT PRIMARY KEY, user_id TEXT, title TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE chat_messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, created_at TEXT);
  `);
  db.prepare(
    "INSERT INTO users (id, email, display_name, password_hash, recovery_code_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("u-1", "one@example.com", "One", "h", "r", new Date().toISOString());

  const store = createSqliteUserDataStore({ db });
  await store.eraseUserData("u-1");

  const remaining = db.prepare("SELECT COUNT(*) n FROM users WHERE id = ?").get("u-1") as { n: number };
  assert.equal(remaining.n, 0, "erasure skips absent tables instead of throwing");
});

test("exporting a user returns their bands, groups, chats and feedback", async () => {
  const db = seededDb();
  const store = createSqliteUserDataStore({ db });

  const bundle = await store.exportUserData("u-1");

  assert.equal(bundle.user?.id, "u-1");
  assert.equal(bundle.savedBands.length, 1, "saved bands are exported");
  assert.equal(bundle.artistGroups.length, 1, "groups are exported");
  assert.equal(bundle.chatSessions.length, 1, "chat sessions are exported");
  assert.equal(bundle.chatSessions[0].messages.length, 1, "messages are nested under their session");
  assert.equal(bundle.recommendationFeedback.length, 1, "feedback is exported");
});

test("an exported user record never contains password or recovery hashes", async () => {
  const db = seededDb();
  const store = createSqliteUserDataStore({ db });

  const bundle = await store.exportUserData("u-1");

  const serialized = JSON.stringify(bundle);
  assert.equal(serialized.includes("recovery-hash"), false, "recovery code hash never leaves the service");
  assert.equal(serialized.includes("password_hash"), false, "password hash column is not exported");
});

test("exporting an unknown user yields an empty bundle rather than throwing", async () => {
  const db = seededDb();
  const store = createSqliteUserDataStore({ db });

  const bundle = await store.exportUserData("nobody");

  assert.equal(bundle.user, null);
  assert.deepEqual(bundle.savedBands, []);
});

test("an unrated band is exported as unrated, not as a zero", () => {
  // `Number(null)` is 0, which is outside the 1-5 range the rest of the system
  // enforces — and this lands in a user-facing GDPR export, the worst place to
  // invent a value the user never chose (#167).
  const band = rowToSavedBand({
    id: "b1",
    musicbrainz_artist_id: "mb-1",
    name: "Codeine",
    rating: null,
    categories: "[]",
    note: "",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(band.rating, null);
});

test("a rated band still exports its rating", () => {
  const band = rowToSavedBand({
    id: "b1",
    musicbrainz_artist_id: "mb-1",
    name: "Codeine",
    rating: 4,
    categories: "[]",
    note: "",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(band.rating, 4);
});

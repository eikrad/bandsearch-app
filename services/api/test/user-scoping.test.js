const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const { createInMemoryPreferenceRepository } = require("../src/preferences/preferenceMemory");
const { createSqlitePreferenceRepository } = require("../src/preferences/sqlitePreferenceRepository");
const { createInMemoryChatSessionRepository, createSqliteChatSessionRepository } = require("../src/sessions/chatSessionRepository");

const BAND = { musicbrainzArtistId: "mb-1", name: "Alcest", rating: 5, categories: ["blackgaze"], note: "" };
const USER_A = "user-a";
const USER_B = "user-b";

function makeSchema(db) {
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_bands (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'anonymous',
      musicbrainz_artist_id TEXT NOT NULL, name TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      categories TEXT NOT NULL DEFAULT '[]', note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS artist_groups (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'anonymous',
      name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS artist_group_members (
      group_id TEXT NOT NULL REFERENCES artist_groups(id) ON DELETE CASCADE,
      saved_band_id TEXT NOT NULL REFERENCES saved_bands(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL, PRIMARY KEY (group_id, saved_band_id)
    );
  `);
}

function memPrefRepo() { return createInMemoryPreferenceRepository(); }
function sqlitePrefRepo() { const db = new Database(":memory:"); makeSchema(db); return createSqlitePreferenceRepository({ db }); }
function memSessionRepo() { return createInMemoryChatSessionRepository(); }
function sqliteSessionRepo() { const db = new Database(":memory:"); return createSqliteChatSessionRepository({ db }); }

// --- Preference isolation ---

for (const [label, makeRepo] of [["in-memory", memPrefRepo], ["sqlite", sqlitePrefRepo]]) {
  test(`${label}: user A's bands are not visible to user B`, async () => {
    const repo = makeRepo();
    await repo.addSavedBand(BAND, USER_A);
    assert.equal((await repo.listSavedBands(USER_B)).length, 0);
  });

  test(`${label}: each user sees only their own bands`, async () => {
    const repo = makeRepo();
    const bandB = { ...BAND, musicbrainzArtistId: "mb-2", name: "Deafheaven" };
    await repo.addSavedBand(BAND, USER_A);
    await repo.addSavedBand(bandB, USER_B);
    const a = await repo.listSavedBands(USER_A);
    const b = await repo.listSavedBands(USER_B);
    assert.equal(a.length, 1);
    assert.equal(a[0].name, "Alcest");
    assert.equal(b.length, 1);
    assert.equal(b[0].name, "Deafheaven");
  });

  test(`${label}: user B cannot delete user A's band`, async () => {
    const repo = makeRepo();
    const res = await repo.addSavedBand(BAND, USER_A);
    const del = await repo.deleteSavedBand(res.savedBand.id, USER_B);
    assert.equal(del.ok, false);
    assert.equal(del.status, 404);
  });

  test(`${label}: buildContext returns only calling user's bands`, async () => {
    const repo = makeRepo();
    await repo.addSavedBand(BAND, USER_A);
    assert.equal(await repo.buildContext(USER_B), "");
    assert.ok((await repo.buildContext(USER_A)).includes("Alcest"));
  });

  test(`${label}: groups are scoped per user`, async () => {
    const repo = makeRepo();
    await repo.createGroup("Metal", USER_A);
    assert.equal((await repo.listGroups(USER_B)).length, 0);
    assert.equal((await repo.listGroups(USER_A)).length, 1);
  });
}

// --- Session isolation ---

for (const [label, makeRepo] of [["in-memory sessions", memSessionRepo], ["sqlite sessions", sqliteSessionRepo]]) {
  test(`${label}: user A's sessions not visible to user B`, async () => {
    const repo = makeRepo();
    await repo.createSession({ title: "Session A" }, USER_A);
    assert.equal((await repo.listSessions(USER_B)).length, 0);
  });

  test(`${label}: getSession returns null for other user's session`, async () => {
    const repo = makeRepo();
    const session = await repo.createSession({ title: "S" }, USER_A);
    assert.equal(await repo.getSession(session.id, USER_B), null);
  });

  test(`${label}: listSessions returns only own sessions`, async () => {
    const repo = makeRepo();
    await repo.createSession({ title: "A" }, USER_A);
    await repo.createSession({ title: "B" }, USER_B);
    assert.equal((await repo.listSessions(USER_A)).length, 1);
    assert.equal((await repo.listSessions(USER_B)).length, 1);
  });
}

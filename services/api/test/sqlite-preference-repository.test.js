const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const { createSqlitePreferenceRepository } = require("../src/preferences/sqlitePreferenceRepository");

function createTestDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE saved_bands (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'anonymous',
      musicbrainz_artist_id TEXT NOT NULL,
      name TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      categories TEXT NOT NULL DEFAULT '[]',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE artist_groups (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'anonymous',
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE artist_group_members (
      group_id TEXT NOT NULL REFERENCES artist_groups(id) ON DELETE CASCADE,
      saved_band_id TEXT NOT NULL REFERENCES saved_bands(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL,
      PRIMARY KEY (group_id, saved_band_id)
    );
  `);
  db.pragma("foreign_keys = ON");
  return db;
}

test("sqlite repository adds and retrieves a saved band", async () => {
  const repo = createSqlitePreferenceRepository({ db: createTestDb() });

  const result = await repo.addSavedBand({
    musicbrainzArtistId: "mb-1",
    name: "Alcest",
    rating: 5,
    categories: ["blackgaze", "shoegaze"],
    note: "Beautiful",
  });

  assert.equal(result.ok, true);
  assert.equal(result.savedBand.name, "Alcest");
  assert.equal(result.savedBand.rating, 5);
  assert.deepEqual(result.savedBand.categories, ["blackgaze", "shoegaze"]);
  assert.equal(result.savedBand.note, "Beautiful");
  assert.ok(result.savedBand.id, "id must be set");
  assert.ok(result.savedBand.createdAt, "createdAt must be set");
});

test("sqlite repository rejects invalid input", async () => {
  const repo = createSqlitePreferenceRepository({ db: createTestDb() });

  const result = await repo.addSavedBand({ name: "Alcest" });
  assert.equal(result.ok, false);
});

test("sqlite repository lists all saved bands", async () => {
  const repo = createSqlitePreferenceRepository({ db: createTestDb() });

  await repo.addSavedBand({ musicbrainzArtistId: "mb-1", name: "Alcest", rating: 5, categories: [], note: "" });
  await repo.addSavedBand({ musicbrainzArtistId: "mb-2", name: "Fen", rating: 4, categories: [], note: "" });

  const bands = await repo.listSavedBands();
  assert.equal(bands.length, 2);
});

test("sqlite repository updates a saved band", async () => {
  const repo = createSqlitePreferenceRepository({ db: createTestDb() });

  const added = await repo.addSavedBand({
    musicbrainzArtistId: "mb-1",
    name: "Alcest",
    rating: 3,
    categories: ["blackgaze"],
    note: "",
  });

  const updated = await repo.updateSavedBand(added.savedBand.id, { rating: 5, note: "Essential" });
  assert.equal(updated.ok, true);
  assert.equal(updated.savedBand.rating, 5);
  assert.equal(updated.savedBand.note, "Essential");
  assert.deepEqual(updated.savedBand.categories, ["blackgaze"]);
});

test("sqlite repository returns 404 for unknown update id", async () => {
  const repo = createSqlitePreferenceRepository({ db: createTestDb() });
  const result = await repo.updateSavedBand("does-not-exist", { rating: 4 });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test("sqlite repository deletes a saved band", async () => {
  const repo = createSqlitePreferenceRepository({ db: createTestDb() });

  const added = await repo.addSavedBand({
    musicbrainzArtistId: "mb-1",
    name: "Alcest",
    rating: 5,
    categories: [],
    note: "",
  });

  const deleted = await repo.deleteSavedBand(added.savedBand.id);
  assert.equal(deleted.ok, true);
  assert.equal(deleted.deletedId, added.savedBand.id);

  const bands = await repo.listSavedBands();
  assert.equal(bands.length, 0);
});

test("sqlite repository returns 404 for unknown delete id", async () => {
  const repo = createSqlitePreferenceRepository({ db: createTestDb() });
  const result = await repo.deleteSavedBand("does-not-exist");
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test("sqlite repository builds preference context from saved bands", async () => {
  const repo = createSqlitePreferenceRepository({ db: createTestDb() });

  await repo.addSavedBand({
    musicbrainzArtistId: "mb-1",
    name: "Sunn O)))",
    rating: 5,
    categories: ["drone", "metal"],
    note: "Transcendent",
  });

  const context = await repo.buildContext();
  assert.ok(context.includes("Sunn O)))"), "context must include band name");
  assert.ok(context.includes("5/5"), "context must include rating");
});

test("sqlite repository returns empty string context when no bands saved", async () => {
  const repo = createSqlitePreferenceRepository({ db: createTestDb() });
  const context = await repo.buildContext();
  assert.equal(context, "");
});

test("sqlite repository buildContextForIds returns context for given ids", async () => {
  const repo = createSqlitePreferenceRepository({ db: createTestDb() });

  const r1 = await repo.addSavedBand({ musicbrainzArtistId: "mb-1", name: "Alcest", rating: 5, categories: ["blackgaze"], note: "dreamy" });
  await repo.addSavedBand({ musicbrainzArtistId: "mb-2", name: "Fen", rating: 4, categories: ["post-black"], note: "atmospheric" });

  const context = await repo.buildContextForIds([r1.savedBand.id]);

  assert.equal(context.includes("Alcest"), true);
  assert.equal(context.includes("Fen"), false, "should only include given ids");
});

test("sqlite repository buildContextForIds returns empty string for unknown ids", async () => {
  const repo = createSqlitePreferenceRepository({ db: createTestDb() });
  const context = await repo.buildContextForIds(["not-a-real-id"]);
  assert.equal(context, "");
});

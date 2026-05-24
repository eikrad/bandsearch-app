const { Pool } = require("pg");
const Database = require("better-sqlite3");
const { createInMemoryPreferenceRepository } = require("./preferenceMemory");
const { createPostgresPreferenceRepository } = require("./postgresPreferenceRepository");
const { createSqlitePreferenceRepository } = require("./sqlitePreferenceRepository");
const { createTursoPreferenceRepository } = require("./tursoPreferenceRepository");

function addColumnIfMissing(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * PreferenceRepository contract (storage abstraction):
 * - addSavedBand(input)
 * - listSavedBands()
 * - updateSavedBand(id, updates)
 * - deleteSavedBand(id)
 * - buildContext()
 * - buildContextForIds(ids) — subset context for priority artist ids (recommendation pipeline)
 */
function assertPreferenceRepository(repository) {
  const requiredMethods = [
    "addSavedBand",
    "listSavedBands",
    "updateSavedBand",
    "deleteSavedBand",
    "buildContext",
    "buildContextForIds",
    "importSavedBands",
    "listGroups",
    "createGroup",
    "renameGroup",
    "deleteGroup",
    "addArtistToGroup",
    "removeArtistFromGroup",
  ];

  for (const methodName of requiredMethods) {
    if (typeof repository?.[methodName] !== "function") {
      throw new Error(`invalid preference repository: missing method ${methodName}`);
    }
  }

  return repository;
}

function createPreferenceRepository(runtimeConfig = {}) {
  if (runtimeConfig.preferenceStore === "postgres") {
    const pool = new Pool({
      connectionString: runtimeConfig.databaseUrl,
      ssl: runtimeConfig.databaseSsl ? { rejectUnauthorized: false } : undefined,
    });
    return createPostgresPreferenceRepository({ pool });
  }
  if (runtimeConfig.preferenceStore === "turso") {
    const { createClient } = require("@libsql/client");
    const client = createClient({
      url: runtimeConfig.tursoDatabaseUrl,
      authToken: runtimeConfig.tursoAuthToken,
    });
    return createTursoPreferenceRepository({ client });
  }
  if (runtimeConfig.preferenceStore === "memory") {
    return createInMemoryPreferenceRepository();
  }
  // Default: SQLite — persistent, zero-config, works everywhere
  const db = new Database(runtimeConfig.databasePath || "bandsearch.db");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_bands (
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
    CREATE TABLE IF NOT EXISTS artist_groups (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'anonymous',
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS artist_group_members (
      group_id TEXT NOT NULL REFERENCES artist_groups(id) ON DELETE CASCADE,
      saved_band_id TEXT NOT NULL REFERENCES saved_bands(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL,
      PRIMARY KEY (group_id, saved_band_id)
    );
  `);
  addColumnIfMissing(db, "saved_bands", "user_id", "TEXT NOT NULL DEFAULT 'anonymous'");
  addColumnIfMissing(db, "artist_groups", "user_id", "TEXT NOT NULL DEFAULT 'anonymous'");
  return createSqlitePreferenceRepository({ db });
}

module.exports = {
  assertPreferenceRepository,
  createPreferenceRepository,
};

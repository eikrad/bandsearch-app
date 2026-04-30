const { Pool } = require("pg");
const Database = require("better-sqlite3");
const { createInMemoryPreferenceRepository } = require("./preferenceMemory");
const { createPostgresPreferenceRepository } = require("./postgresPreferenceRepository");
const { createSqlitePreferenceRepository } = require("./sqlitePreferenceRepository");

/**
 * PreferenceRepository contract (storage abstraction):
 * - addSavedBand(input)
 * - listSavedBands()
 * - updateSavedBand(id, updates)
 * - deleteSavedBand(id)
 * - buildContext()
 */
function assertPreferenceRepository(repository) {
  const requiredMethods = [
    "addSavedBand",
    "listSavedBands",
    "updateSavedBand",
    "deleteSavedBand",
    "buildContext",
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
  if (runtimeConfig.preferenceStore === "memory") {
    return createInMemoryPreferenceRepository();
  }
  // Default: SQLite — persistent, zero-config, works everywhere
  const db = new Database(runtimeConfig.databasePath || "bandsearch.db");
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_bands (
      id TEXT PRIMARY KEY,
      musicbrainz_artist_id TEXT NOT NULL,
      name TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      categories TEXT NOT NULL DEFAULT '[]',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  return createSqlitePreferenceRepository({ db });
}

module.exports = {
  assertPreferenceRepository,
  createPreferenceRepository,
};

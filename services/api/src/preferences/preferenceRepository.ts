/* eslint-disable @typescript-eslint/no-explicit-any */
import { Pool } from "pg";
import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import { createInMemoryPreferenceRepository } from "./preferenceMemory.js";
import { createPostgresPreferenceRepository } from "./postgresPreferenceRepository.js";
import { createSqlitePreferenceRepository } from "./sqlitePreferenceRepository.js";
import { createTursoPreferenceRepository } from "./tursoPreferenceRepository.js";

function addColumnIfMissing(db: import("better-sqlite3").Database, table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function assertPreferenceRepository(repository: any) {
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

export function createPreferenceRepository(runtimeConfig: any = {}) {
  if (runtimeConfig.preferenceStore === "postgres") {
    const pool = new Pool({
      connectionString: runtimeConfig.databaseUrl,
      ssl: runtimeConfig.databaseSsl ? { rejectUnauthorized: false } : undefined,
    });
    return createPostgresPreferenceRepository({ pool });
  }
  if (runtimeConfig.preferenceStore === "turso") {
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

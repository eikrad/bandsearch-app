import Database from "better-sqlite3";

import type { TursoClient, TursoResult, TursoStatement, TursoValue } from "../../src/turso/tursoClient.js";

/**
 * A libSQL-shaped client backed by an in-memory SQLite database.
 *
 * The existing Turso tests hand the repository a hand-written fake that returns
 * canned rows, which pins down the SQL the adapter emits but cannot show whether
 * that SQL does the right thing. Running the same statements through real SQLite
 * does: `RETURNING *`, `INSERT OR IGNORE`, `rowsAffected` and the foreign-key
 * cascade all behave as they would against Turso, which speaks SQLite too.
 *
 * Scope is deliberately the slice `TursoClient` declares — `execute` and `batch`
 * — and nothing more.
 */

export const PREFERENCE_SCHEMA = `
  CREATE TABLE saved_bands (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'anonymous',
    musicbrainz_artist_id TEXT NOT NULL,
    name TEXT NOT NULL,
    rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
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
`;

export function createPreferenceTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(PREFERENCE_SCHEMA);
  db.pragma("foreign_keys = ON");
  return db;
}

/** better-sqlite3 binds numbers and strings; libSQL also accepts booleans and Dates. */
function toBindable(value: TursoValue): string | number | bigint | null | Uint8Array {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function createSqliteBackedTursoClient(db: Database.Database): TursoClient {
  function runOne(statement: TursoStatement | string): TursoResult {
    const { sql, args = [] } = typeof statement === "string" ? { sql: statement, args: [] } : statement;
    const prepared = db.prepare(sql);
    const bound = args.map(toBindable);

    // `reader` is true for anything that yields rows — SELECT, and also the
    // INSERT/UPDATE ... RETURNING * the adapter uses to read a row back.
    if (prepared.reader) {
      const rows = prepared.all(...bound) as Record<string, unknown>[];
      return { rows, rowsAffected: rows.length };
    }

    const info = prepared.run(...bound);
    return { rows: [], rowsAffected: info.changes };
  }

  return {
    async execute(statement) {
      return runOne(statement);
    },
    async batch(statements) {
      return db.transaction(() => statements.map(runOne))();
    },
  };
}

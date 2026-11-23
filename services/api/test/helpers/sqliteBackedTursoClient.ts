import Database from "better-sqlite3";

import type { TursoClient, TursoResult, TursoStatement, TursoValue } from "../../src/turso/tursoClient.js";
import { applyMigrations } from "../../scripts/migrationFiles.js";

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

/**
 * An in-memory database with Turso's schema, built from `migrations/` exactly
 * as `npm run migrate:turso` builds it, so these tests cannot drift from the
 * schema production runs (#168).
 */
export function createTursoTestDb(): Database.Database {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.pragma("foreign_keys = ON");
  return db;
}

/** better-sqlite3 binds numbers and strings; libSQL also accepts booleans and Dates. */
function toBindable(value: TursoValue): string | number | bigint | null | Uint8Array {
  // libSQL rejects undefined with "Unsupported type of value"; better-sqlite3
  // quietly turns it into NULL. Left permissive, this double would accept an
  // adapter bug that 500s against a real Turso database — which is exactly what
  // it did for an omitted rating.
  if (value === undefined) {
    throw new TypeError("Unsupported type of value: undefined (libSQL rejects it; bind null instead)");
  }
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

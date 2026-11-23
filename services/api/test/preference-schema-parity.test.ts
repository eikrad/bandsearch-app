import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createSqlitePreferenceRepository } from "../src/preferences/sqlitePreferenceRepository.js";
import { applyMigrations } from "../scripts/migrationFiles.js";

/**
 * Production defines the preference tables twice: SQLite creates them at boot
 * (`createSqlitePreferenceRepository`), Turso gets them from `migrations/`.
 * Tests build their databases from those same two sources (#168), so this is
 * the one place that checks the two agree.
 */

const PREFERENCE_TABLES = ["saved_bands", "artist_groups", "artist_group_members"];

function sqliteRuntimeDb(): Database.Database {
  const db = new Database(":memory:");
  createSqlitePreferenceRepository({ db });
  return db;
}

function tursoMigratedDb(): Database.Database {
  const db = new Database(":memory:");
  applyMigrations(db);
  return db;
}

type Column = { cid: number; name: string; type: string; notnull: number; dflt_value: unknown; pk: number };

/**
 * Columns by name, not position: a migration's ADD COLUMN appends, so a
 * migrated table can order its columns differently from a freshly created one.
 * Every query names its columns, so only the set matters.
 */
function shape(db: Database.Database, table: string) {
  const columns = (db.pragma(`table_info(${table})`) as Column[])
    .map(({ name, type, notnull, dflt_value, pk }) => ({ name, type, notnull, dflt_value, pk }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { columns, foreignKeys: db.pragma(`foreign_key_list(${table})`) };
}

for (const table of PREFERENCE_TABLES) {
  test(`SQLite at boot and the Turso migrations give ${table} the same columns and foreign keys`, () => {
    assert.deepEqual(shape(sqliteRuntimeDb(), table), shape(tursoMigratedDb(), table));
  });
}

test("both schemas reject a rating outside 1-5 and accept no rating", () => {
  for (const db of [sqliteRuntimeDb(), tursoMigratedDb()]) {
    const insert = db.prepare(
      `INSERT INTO saved_bands (id, musicbrainz_artist_id, name, rating, created_at, updated_at)
       VALUES (?, 'mb', 'Band', ?, 'now', 'now')`,
    );
    assert.throws(() => insert.run("too-high", 6), /CHECK constraint failed/);
    assert.throws(() => insert.run("too-low", 0), /CHECK constraint failed/);
    assert.doesNotThrow(() => insert.run("unrated", null));
  }
});

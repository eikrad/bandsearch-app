import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const MIGRATIONS = path.join(__dirname, "..", "..", "migrations");

/**
 * A database shaped like a Turso deployment after `npm run migrate:turso`:
 * the full schema (002) plus the closed-beta tables and columns (005).
 * Using the shipped migration files means the Turso adapters are tested
 * against the schema they will actually meet, not a hand-copied one.
 */
export function createMigratedAuthTestDb(): Database.Database {
  const db = new Database(":memory:");
  for (const file of ["002_full_schema.sql", "005_closed_beta_invites.sql"]) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS, file), "utf8"));
  }
  return db;
}

import fs from "node:fs";
import path from "node:path";
import type { Database } from "better-sqlite3";

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

export type Migration = { filename: string; sql: string };

/** The schema migrations in the order they are applied: by filename. */
export function listMigrations(): Migration[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((filename) => ({ filename, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8") }));
}

/**
 * Builds a fresh database the way `npm run migrate:turso` builds Turso's: every
 * migration in order. Tests use it so a Turso-backed test runs against the
 * schema production has, not a copy of it (#168).
 */
export function applyMigrations(db: Database): void {
  for (const { sql } of listMigrations()) db.exec(sql);
}

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { createClient } from "@libsql/client";

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

/**
 * Records which migrations have run, so each is applied exactly once.
 *
 * Without it, re-running the script re-executes every file. `002` is
 * `CREATE TABLE IF NOT EXISTS` and shrugs that off, but `003` rebuilds
 * `saved_bands` by copying every row — unconditionally, on every run, growing
 * with the data.
 */
const LEDGER_DDL = "CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL);";

async function migrationFiles(): Promise<string[]> {
  const files = await fs.readdir(MIGRATIONS_DIR);
  return files.filter((f) => f.endsWith(".sql")).sort();
}

/** Applies the pending migrations through whichever backend the caller drives. */
async function applyPending(backend: {
  label: string;
  executeMultiple: (sql: string) => Promise<void>;
  appliedFilenames: () => Promise<Set<string>>;
  recordApplied: (filename: string) => Promise<void>;
}): Promise<void> {
  await backend.executeMultiple(LEDGER_DDL);
  const applied = await backend.appliedFilenames();

  let ran = 0;
  for (const file of await migrationFiles()) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    await backend.executeMultiple(sql);
    await backend.recordApplied(file);
    console.log(`Migration applied (${backend.label}): ${file}`);
    ran += 1;
  }
  if (ran === 0) console.log(`No pending migrations (${backend.label}).`);
}

async function migrateTurso(): Promise<void> {
  const databaseUrl = process.env.TURSO_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("TURSO_DATABASE_URL is required to run Turso migrations");
  }

  const client = createClient({ url: databaseUrl, authToken: process.env.TURSO_AUTH_TOKEN ?? "" });
  try {
    await applyPending({
      label: "turso",
      executeMultiple: (sql) => client.executeMultiple(sql),
      appliedFilenames: async () => {
        const result = await client.execute("SELECT filename FROM schema_migrations");
        return new Set(result.rows.map((r) => String(r.filename)));
      },
      recordApplied: async (filename) => {
        await client.execute({
          sql: "INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)",
          args: [filename, new Date().toISOString()],
        });
      },
    });
  } finally {
    client.close();
  }
}

/**
 * SQLite needs migrations too, despite creating its tables at boot.
 *
 * `createPreferenceRepository` uses `CREATE TABLE IF NOT EXISTS`, which is a
 * no-op against a database that already exists — so a schema change that alters
 * an existing column (like making `rating` nullable) never reaches it. That is
 * how #164 would have shipped working only on fresh databases.
 */
async function migrateSqlite(): Promise<void> {
  const databasePath = process.env.SQLITE_DATABASE_PATH || "bandsearch.db";
  const db = new Database(databasePath);
  try {
    await applyPending({
      label: `sqlite:${databasePath}`,
      executeMultiple: async (sql) => { db.exec(sql); },
      appliedFilenames: async () =>
        new Set((db.prepare("SELECT filename FROM schema_migrations").all() as { filename: string }[]).map((r) => r.filename)),
      recordApplied: async (filename) => {
        db.prepare("INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)").run(filename, new Date().toISOString());
      },
    });
  } finally {
    db.close();
  }
}

async function runMigrations(): Promise<void> {
  if (process.env.PREFERENCE_STORE === "postgres" || process.env.DATABASE_URL) {
    throw new Error(
      "Postgres migrations were removed along with the Postgres adapter. "
      + "Set TURSO_DATABASE_URL and run `npm run migrate:turso`, or run without it for SQLite.",
    );
  }
  if (process.env.TURSO_DATABASE_URL) await migrateTurso();
  else await migrateSqlite();
}

runMigrations().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});

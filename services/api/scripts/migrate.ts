import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@libsql/client";

async function migrateTurso(): Promise<void> {
  const databaseUrl = process.env.TURSO_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("TURSO_DATABASE_URL is required to run Turso migrations");
  }

  const client = createClient({
    url: databaseUrl,
    authToken: process.env.TURSO_AUTH_TOKEN ?? "",
  });

  const migrationPath = path.join(__dirname, "..", "migrations", "002_full_schema.sql");
  const sql = await fs.readFile(migrationPath, "utf8");

  try {
    await client.executeMultiple(sql);
    console.log("Migration applied: 002_full_schema.sql");
  } finally {
    client.close();
  }
}

// Turso is the only backend that needs a migration run: SQLite creates its own
// schema in createPreferenceRepository, and the Postgres adapter was removed.
async function runMigrations(): Promise<void> {
  if (process.env.PREFERENCE_STORE === "postgres" || process.env.DATABASE_URL) {
    throw new Error(
      "Postgres migrations were removed along with the Postgres adapter. "
      + "Set TURSO_DATABASE_URL and run `npm run migrate:turso`, or use the SQLite "
      + "default, which needs no migration step.",
    );
  }
  await migrateTurso();
}

runMigrations().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});

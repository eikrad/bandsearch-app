import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { Client as PgClient } from "pg";
import { createClient } from "@libsql/client";

async function migratePostgres(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations");
  }

  const migrationPath = path.join(__dirname, "..", "migrations", "001_create_saved_bands.sql");
  const sql = await fs.readFile(migrationPath, "utf8");

  const client = new PgClient({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();
  try {
    await client.query(sql);
    console.log("Migration applied: 001_create_saved_bands.sql");
  } finally {
    await client.end();
  }
}

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

async function runMigrations(): Promise<void> {
  const useTurso = process.argv.includes("--turso") || process.env.PREFERENCE_STORE === "turso";
  if (useTurso) {
    await migrateTurso();
  } else {
    await migratePostgres();
  }
}

runMigrations().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});

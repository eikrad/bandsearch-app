require("dotenv").config();
const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");

async function migratePostgres() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations");
  }

  const migrationPath = path.join(__dirname, "..", "migrations", "001_create_saved_bands.sql");
  const sql = await fs.readFile(migrationPath, "utf8");

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await pool.query(sql);
    console.log("Migration applied: 001_create_saved_bands.sql");
  } finally {
    await pool.end();
  }
}

async function migrateTurso() {
  const databaseUrl = process.env.TURSO_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("TURSO_DATABASE_URL is required to run Turso migrations");
  }

  const { createClient } = require("@libsql/client");
  const client = createClient({
    url: databaseUrl,
    authToken: process.env.TURSO_AUTH_TOKEN || "",
  });

  const migrationPath = path.join(__dirname, "..", "migrations", "001_create_saved_bands_sqlite.sql");
  const sql = await fs.readFile(migrationPath, "utf8");

  try {
    await client.executeMultiple(sql);
    console.log("Migration applied: 001_create_saved_bands_sqlite.sql");
  } finally {
    client.close();
  }
}

async function runMigrations() {
  const store = process.env.PREFERENCE_STORE || "sqlite";
  if (store === "turso") {
    await migrateTurso();
  } else {
    await migratePostgres();
  }
}

runMigrations().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

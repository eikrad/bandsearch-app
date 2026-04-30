require("dotenv").config();
const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");

async function runMigrations() {
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

runMigrations().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

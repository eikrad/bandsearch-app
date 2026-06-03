const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const SCHEMA_PATH = path.join(__dirname, "..", "migrations", "002_full_schema.sql");

const REQUIRED_TABLES = [
  "saved_bands",
  "artist_groups",
  "artist_group_members",
  "users",
  "chat_sessions",
  "chat_messages",
  "recommendation_events",
  "band_eval_scores",
  "recommendation_feedback",
  "eval_baselines",
];

test("002_full_schema.sql exists and creates all required tables", async () => {
  const sql = await fs.readFile(SCHEMA_PATH, "utf8");

  for (const table of REQUIRED_TABLES) {
    assert.ok(
      sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`),
      `schema must contain CREATE TABLE IF NOT EXISTS ${table}`,
    );
  }
});

test("002_full_schema.sql: saved_bands has user_id column", async () => {
  const sql = await fs.readFile(SCHEMA_PATH, "utf8");
  const savedBandsBlock = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS saved_bands"));
  assert.ok(savedBandsBlock.includes("user_id"), "saved_bands must have user_id column");
});

test("002_full_schema.sql: chat_sessions has user_id column", async () => {
  const sql = await fs.readFile(SCHEMA_PATH, "utf8");
  const block = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS chat_sessions"));
  assert.ok(block.includes("user_id"), "chat_sessions must have user_id column");
});

test("002_full_schema.sql: artist_group_members has ON DELETE CASCADE", async () => {
  const sql = await fs.readFile(SCHEMA_PATH, "utf8");
  const block = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS artist_group_members"));
  assert.ok(block.includes("ON DELETE CASCADE"), "artist_group_members must have cascade deletes");
});

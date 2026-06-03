#!/usr/bin/env tsx
// Creates a user directly in the database (SQLite or Turso).
// Usage:
//   tsx scripts/create-user.ts --email user@example.com --name "Max" --password "secret"
// For Turso:
//   PREFERENCE_STORE=turso TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... tsx scripts/create-user.ts ...

import "dotenv/config";
import { randomUUID, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

function parseArgs(): { email?: string; name?: string; password?: string } {
  const args = process.argv.slice(2);
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--email") result.email = args[++i];
    else if (args[i] === "--name") result.name = args[++i];
    else if (args[i] === "--password") result.password = args[++i];
  }
  return result;
}

function generateRecoveryCode(): string {
  const hex = randomBytes(20).toString("hex");
  return (hex.match(/.{1,5}/g) ?? []).join("-");
}

async function createUserSqlite({ email, name, password }: { email: string; name: string; password: string }) {
  const Database = (await import("better-sqlite3")).default;
  const path = await import("node:path");
  const dbPath = process.env.SQLITE_PATH ?? path.join(__dirname, "..", "bandsearch.db");
  const db = new Database(dbPath);

  const passwordHash = await bcrypt.hash(password, 10);
  const recoveryCode = generateRecoveryCode();
  const recoveryCodeHash = await bcrypt.hash(recoveryCode, 10);
  const id = randomUUID();
  const normalizedEmail = email.trim().toLowerCase();
  const createdAt = new Date().toISOString();

  db.prepare(
    "INSERT INTO users (id, email, display_name, password_hash, recovery_code_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, normalizedEmail, name, passwordHash, recoveryCodeHash, createdAt);

  db.close();
  return { id, email: normalizedEmail, recoveryCode };
}

async function createUserTurso({ email, name, password }: { email: string; name: string; password: string }) {
  const { createClient } = await import("@libsql/client");
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL ?? "",
    authToken: process.env.TURSO_AUTH_TOKEN ?? "",
  });

  const passwordHash = await bcrypt.hash(password, 10);
  const recoveryCode = generateRecoveryCode();
  const recoveryCodeHash = await bcrypt.hash(recoveryCode, 10);
  const id = randomUUID();
  const normalizedEmail = email.trim().toLowerCase();
  const createdAt = new Date().toISOString();

  await client.execute({
    sql: "INSERT INTO users (id, email, display_name, password_hash, recovery_code_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: [id, normalizedEmail, name, passwordHash, recoveryCodeHash, createdAt],
  });

  client.close();
  return { id, email: normalizedEmail, recoveryCode };
}

async function main(): Promise<void> {
  const { email, name, password } = parseArgs();

  if (!email || !name || !password) {
    console.error("Usage: tsx scripts/create-user.ts --email <email> --name <name> --password <password>");
    process.exitCode = 1;
    return;
  }

  const store = process.env.PREFERENCE_STORE ?? "sqlite";
  const createUser = store === "turso" ? createUserTurso : createUserSqlite;

  try {
    const user = await createUser({ email, name, password });
    console.log(`\nUser created successfully!`);
    console.log(`  ID:    ${user.id}`);
    console.log(`  Email: ${user.email}`);
    console.log(`\nRecovery code (save this — it won't be shown again):`);
    console.log(`  ${user.recoveryCode}\n`);
  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

main();

#!/usr/bin/env tsx
// Closed-beta administration, run by whoever holds the database credentials.
//   npm run invite:create --workspace @bandsearch/api -- --email x@y.de [--days 14]
//   npm run invite:list   --workspace @bandsearch/api
//   npm run invite:revoke --workspace @bandsearch/api -- --email x@y.de
//   npm run user:disable  --workspace @bandsearch/api -- --email x@y.de
//   npm run user:enable   --workspace @bandsearch/api -- --email x@y.de
//
// Picks its database like the server does: Turso when PREFERENCE_STORE is
// turso or turso-sync (the cloud database is the source of truth, a sync
// replica only mirrors it), otherwise the local SQLite file.

import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";

const rootDir = resolve(__dirname, "../../..");
dotenvConfig({ path: resolve(rootDir, ".env") });

import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import { AdminCommandError, runAdminCommand } from "../src/auth/adminCommands.js";
import { createSqliteInviteRepository, type InviteRepository } from "../src/auth/inviteRepository.js";
import { createInviteService } from "../src/auth/inviteService.js";
import { createTursoInviteRepository } from "../src/auth/tursoInviteRepository.js";
import { createTursoUserRepository } from "../src/auth/tursoUserRepository.js";
import { createSqliteUserRepository, type UserRepository } from "../src/auth/userRepository.js";

function openStores(): { inviteRepository: InviteRepository; userRepository: UserRepository; close: () => void } {
  const store = process.env.PREFERENCE_STORE ?? "sqlite";
  if (store === "turso" || store === "turso-sync") {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) throw new AdminCommandError("TURSO_DATABASE_URL is required for PREFERENCE_STORE=" + store);
    const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN ?? "" });
    return {
      inviteRepository: createTursoInviteRepository({ client }),
      userRepository: createTursoUserRepository({ client }),
      close: () => client.close(),
    };
  }
  const db = new Database(resolve(rootDir, process.env.DATABASE_PATH || "bandsearch.db"));
  return {
    inviteRepository: createSqliteInviteRepository({ db }),
    userRepository: createSqliteUserRepository({ db }),
    close: () => db.close(),
  };
}

async function main(): Promise<void> {
  const [command = "", ...args] = process.argv.slice(2);
  const stores = openStores();
  try {
    const invites = createInviteService({ inviteRepository: stores.inviteRepository });
    const lines = await runAdminCommand(command, args, { invites, userRepository: stores.userRepository });
    console.log(lines.join("\n"));
  } finally {
    stores.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof AdminCommandError ? err.message : err);
  process.exitCode = 1;
});

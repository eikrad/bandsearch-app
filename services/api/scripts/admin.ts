#!/usr/bin/env tsx
// Closed-beta administration, run by whoever holds the database credentials.
//   npm run invite:create --workspace @bandsearch/api -- --email x@y.de [--days 14]
//   npm run invite:list   --workspace @bandsearch/api
//   npm run invite:revoke --workspace @bandsearch/api -- --email x@y.de
//   npm run user:disable  --workspace @bandsearch/api -- --email x@y.de
//   npm run user:enable   --workspace @bandsearch/api -- --email x@y.de
//   npm run feedback:list --workspace @bandsearch/api -- [--days 7] [--json]
//
// Opens the same database as the server, through the same storage module:
// Turso when PREFERENCE_STORE is turso or turso-sync (under turso-sync the
// cloud database directly, since a replica only mirrors it), otherwise the
// local SQLite file.

import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";

const rootDir = resolve(__dirname, "../../..");
dotenvConfig({ path: resolve(rootDir, ".env") });

import { AdminCommandError, runAdminCommand } from "../src/auth/adminCommands.js";
import { createInviteService } from "../src/auth/inviteService.js";
import { createRecommendationFeedback } from "../src/feedback/recommendationFeedback.js";
import { openAdminStorage } from "../src/storage/createStorage.js";

async function main(): Promise<void> {
  const [command = "", ...args] = process.argv.slice(2);
  const store = process.env.PREFERENCE_STORE ?? "sqlite";
  if ((store === "turso" || store === "turso-sync") && !process.env.TURSO_DATABASE_URL) {
    throw new AdminCommandError("TURSO_DATABASE_URL is required for PREFERENCE_STORE=" + store);
  }
  let storage;
  try {
    storage = openAdminStorage({
      preferenceStore: store,
      databasePath: resolve(rootDir, process.env.DATABASE_PATH || "bandsearch.db"),
      tursoDatabaseUrl: process.env.TURSO_DATABASE_URL,
      tursoAuthToken: process.env.TURSO_AUTH_TOKEN,
    });
  } catch (error) {
    throw new AdminCommandError(error instanceof Error ? error.message : String(error));
  }
  try {
    const lines = await runAdminCommand(command, args, {
      invites: createInviteService({ inviteRepository: storage.inviteRepository }),
      userRepository: storage.userRepository,
      feedback: createRecommendationFeedback({ repository: storage.recommendationFeedbackRepository }),
    });
    console.log(lines.join("\n"));
  } finally {
    await storage.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof AdminCommandError ? err.message : err);
  process.exitCode = 1;
});

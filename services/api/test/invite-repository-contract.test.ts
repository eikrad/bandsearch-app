import Database from "better-sqlite3";

import { createInMemoryInviteRepository, createSqliteInviteRepository } from "../src/auth/inviteRepository.js";
import { createTursoInviteRepository } from "../src/auth/tursoInviteRepository.js";

import { runInviteRepositoryContract } from "./helpers/inviteRepositoryContract.js";
import { createMigratedAuthTestDb } from "./helpers/authTestDb.js";
import { createSqliteBackedTursoClient } from "./helpers/sqliteBackedTursoClient.js";

runInviteRepositoryContract("memory", () => createInMemoryInviteRepository());

runInviteRepositoryContract("sqlite", () => createSqliteInviteRepository({ db: new Database(":memory:") }));

runInviteRepositoryContract("turso", () =>
  createTursoInviteRepository({ client: createSqliteBackedTursoClient(createMigratedAuthTestDb()) }),
);

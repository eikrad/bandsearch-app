import Database from "better-sqlite3";
import { createInMemoryPreferenceRepository } from "../src/preferences/preferenceMemory.js";
import { createSqlitePreferenceRepository } from "../src/preferences/sqlitePreferenceRepository.js";
import { createTursoPreferenceRepository } from "../src/preferences/tursoPreferenceRepository.js";

import { runPreferenceRepositoryContract } from "./helpers/preferenceRepositoryContract.js";
import { createTursoTestDb, createSqliteBackedTursoClient } from "./helpers/sqliteBackedTursoClient.js";

/**
 * The BandGroupRepository half of every adapter, held to one shared suite.
 *
 * The per-adapter files cover add/list/update/delete against their own backend;
 * this covers the seven group and import methods, which were previously only
 * exercised on the in-memory adapter even though SQLite and Turso are what
 * deployments actually run.
 */

/** The SQLite adapter creates its own tables, as it does at boot. */
function createSqliteTestDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return db;
}

runPreferenceRepositoryContract("memory", () => createInMemoryPreferenceRepository());

runPreferenceRepositoryContract("sqlite", () =>
  createSqlitePreferenceRepository({ db: createSqliteTestDb() }),
);

runPreferenceRepositoryContract("turso", () =>
  createTursoPreferenceRepository({ client: createSqliteBackedTursoClient(createTursoTestDb()) }),
);

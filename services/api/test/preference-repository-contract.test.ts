import { createInMemoryPreferenceRepository } from "../src/preferences/preferenceMemory.js";
import { createSqlitePreferenceRepository } from "../src/preferences/sqlitePreferenceRepository.js";
import { createTursoPreferenceRepository } from "../src/preferences/tursoPreferenceRepository.js";

import { runPreferenceRepositoryContract } from "./helpers/preferenceRepositoryContract.js";
import { createPreferenceTestDb, createSqliteBackedTursoClient } from "./helpers/sqliteBackedTursoClient.js";

/**
 * The BandGroupRepository half of every adapter, held to one shared suite.
 *
 * The per-adapter files cover add/list/update/delete against their own backend;
 * this covers the seven group and import methods, which were previously only
 * exercised on the in-memory adapter even though SQLite and Turso are what
 * deployments actually run.
 */

runPreferenceRepositoryContract("memory", () => createInMemoryPreferenceRepository());

runPreferenceRepositoryContract("sqlite", () =>
  createSqlitePreferenceRepository({ db: createPreferenceTestDb() }),
);

runPreferenceRepositoryContract("turso", () =>
  createTursoPreferenceRepository({ client: createSqliteBackedTursoClient(createPreferenceTestDb()) }),
);

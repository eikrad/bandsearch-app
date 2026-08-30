import Database from "better-sqlite3";

import { createInMemoryEvalRepository, createSqliteEvalRepository } from "../../src/eval/evalRepository.js";
import { runEvalRepositoryContract } from "../helpers/evalRepositoryContract.js";

/**
 * Both eval-store adapters, held to one suite.
 *
 * `createSqliteEvalRepository` creates its own tables, so an empty in-memory
 * database is all it needs.
 */

runEvalRepositoryContract("memory", () => createInMemoryEvalRepository());

runEvalRepositoryContract("sqlite", () => createSqliteEvalRepository({ db: new Database(":memory:") }));

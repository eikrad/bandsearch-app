import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import { createInMemoryPreferenceRepository } from "../preferences/preferenceMemory.js";
import { createSqlitePreferenceRepository } from "../preferences/sqlitePreferenceRepository.js";
import { POSTGRES_REMOVED_MESSAGE, TURSO_SYNC_ASYNC_MESSAGE } from "../preferences/preferenceRepository.js";
import { createInMemoryUserRepository, createSqliteUserRepository } from "../auth/userRepository.js";
import { createInMemoryInviteRepository, createSqliteInviteRepository } from "../auth/inviteRepository.js";
import { createInMemoryChatSessionRepository, createSqliteChatSessionRepository } from "../sessions/chatSessionRepository.js";
import { createSqliteUserDataStore } from "../privacy/userDataStore.js";
import { createInMemoryFeedbackRepository, createSqliteFeedbackRepository } from "../feedback/feedbackRepository.js";
import {
  createInMemoryEvalRepository,
  createNoOpEvalRepository,
  createSqliteEvalRepository,
  type EvalRepository,
} from "../eval/evalRepository.js";
import { createTursoSyncRepositories } from "../turso/tursoSyncRepositories.js";
import { createTursoRepositories, type StorageRepositories } from "./storageRepositories.js";

export type StorageConfig = {
  /** Chooses the database for every account repository, not only preferences. */
  preferenceStore?: string;
  databasePath?: string;
  tursoDatabaseUrl?: string;
  tursoAuthToken?: string;
  tursoSyncPath?: string;
  evalDashboardEnabled?: boolean;
};

export type StorageOverrides = Partial<StorageRepositories> & { evalRepository?: EvalRepository };

/**
 * Every store the API uses. Account repositories share one backend. Eval
 * telemetry is operator data and never lives on Turso: a local SQLite file
 * (or memory on a memory install) while the dashboard is enabled, otherwise a
 * no-op that records nothing.
 */
export type Storage = StorageRepositories & { evalRepository: EvalRepository; close(): Promise<void> };

/**
 * Select defaults once. Overrides replace only the named repository; they never
 * influence the backend of the remaining defaults. Callers supplying custom
 * repositories are responsible for their compatibility with account erasure.
 * Opening a selected backend fails at startup rather than swapping databases.
 */
export function createStorage(
  config: StorageConfig = {},
  overrides: StorageOverrides = {},
): Storage {
  const store = config.preferenceStore ?? "sqlite";
  if (store === "postgres") throw new Error(POSTGRES_REMOVED_MESSAGE);
  if (!["sqlite", "memory", "turso", "turso-sync"].includes(store)) {
    throw new Error(`unsupported PREFERENCE_STORE=${store}`);
  }

  let database: Database.Database | undefined;
  let client: ReturnType<typeof createClient> | undefined;
  const sqlite = () => {
    if (!database) {
      database = new Database(config.databasePath || ":memory:");
      database.pragma("foreign_keys = ON");
    }
    return database;
  };
  // Eval keeps its own connection even when it shares the file with the
  // account repositories: it was never written for foreign_keys = ON.
  let evalDatabase: Database.Database | undefined;
  let tursoRepositories: StorageRepositories | undefined;
  const turso = () => {
    if (!tursoRepositories) {
      client = createClient({ url: config.tursoDatabaseUrl ?? "", authToken: config.tursoAuthToken });
      tursoRepositories = createTursoRepositories(client);
    }
    return tursoRepositories;
  };
  async function close() {
    evalDatabase?.close();
    database?.close();
    client?.close();
  }
  const selectEvalRepository = (): EvalRepository => {
    if (overrides.evalRepository) return overrides.evalRepository;
    if (!config.evalDashboardEnabled) return createNoOpEvalRepository();
    if (store === "memory") return createInMemoryEvalRepository();
    evalDatabase = new Database(config.databasePath || ":memory:");
    return createSqliteEvalRepository({ db: evalDatabase });
  };

  try {
    if (store === "turso-sync" && (
      !overrides.preferenceRepository || !overrides.userRepository || !overrides.inviteRepository
      || !overrides.chatSessionRepository || !overrides.recommendationFeedbackRepository
      || overrides.userDataStore === undefined
    )) {
      throw new Error(TURSO_SYNC_ASYNC_MESSAGE);
    }
    return {
      preferenceRepository: overrides.preferenceRepository ?? (
        store === "turso" ? turso().preferenceRepository
          : store === "memory" ? createInMemoryPreferenceRepository()
            : createSqlitePreferenceRepository({ db: sqlite() })
      ),
      userRepository: overrides.userRepository ?? (
        store === "turso" ? turso().userRepository
          : store === "memory" ? createInMemoryUserRepository()
            : createSqliteUserRepository({ db: sqlite() })
      ),
      inviteRepository: overrides.inviteRepository ?? (
        store === "turso" ? turso().inviteRepository
          : store === "memory" ? createInMemoryInviteRepository()
            : createSqliteInviteRepository({ db: sqlite() })
      ),
      chatSessionRepository: overrides.chatSessionRepository ?? (
        store === "turso" ? turso().chatSessionRepository
          : store === "memory" ? createInMemoryChatSessionRepository()
            : createSqliteChatSessionRepository({ db: sqlite() })
      ),
      recommendationFeedbackRepository: overrides.recommendationFeedbackRepository ?? (
        store === "turso" ? turso().recommendationFeedbackRepository
          : store === "memory" ? createInMemoryFeedbackRepository()
            : createSqliteFeedbackRepository({ db: sqlite() })
      ),
      userDataStore: overrides.userDataStore !== undefined ? overrides.userDataStore : (
        store === "turso" ? turso().userDataStore
          : store === "memory" ? null
            : createSqliteUserDataStore({ db: sqlite() })
      ),
      evalRepository: selectEvalRepository(),
      close,
    };
  } catch (error) {
    void close();
    throw error;
  }
}

/** Startup also owns the asynchronous local replica and its sync loop. */
export async function openStorage(config: StorageConfig = {}): Promise<Storage> {
  if (config.preferenceStore !== "turso-sync") return createStorage(config);
  const { client, ...repositories } = await createTursoSyncRepositories({
    ...config,
    tursoSyncPath: config.tursoSyncPath ?? "bandsearch-sync.db",
  });
  try {
    const storage = createStorage(config, repositories);
    return {
      ...storage,
      async close() {
        await storage.close();
        await client.close();
      },
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}

/**
 * The stores as an operator's CLI sees them. Under turso-sync it talks to the
 * cloud database directly: that is the source of truth, and opening a second
 * replica beside a running server would mean a second sync loop. A memory
 * store has nothing an operator could administer.
 */
export function openAdminStorage(config: StorageConfig = {}): Storage {
  if (config.preferenceStore === "memory") {
    throw new Error("admin commands need a durable database; PREFERENCE_STORE=memory has none");
  }
  return createStorage({
    ...config,
    preferenceStore: config.preferenceStore === "turso-sync" ? "turso" : config.preferenceStore,
    evalDashboardEnabled: false,
  });
}

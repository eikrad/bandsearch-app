import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import { createInMemoryPreferenceRepository } from "../preferences/preferenceMemory.js";
import { createSqlitePreferenceRepository } from "../preferences/sqlitePreferenceRepository.js";
import { POSTGRES_REMOVED_MESSAGE, TURSO_SYNC_ASYNC_MESSAGE } from "../preferences/preferenceRepository.js";
import { createInMemoryUserRepository, createSqliteUserRepository } from "../auth/userRepository.js";
import { createInMemoryInviteRepository, createSqliteInviteRepository } from "../auth/inviteRepository.js";
import { createInMemoryChatSessionRepository, createSqliteChatSessionRepository } from "../sessions/chatSessionRepository.js";
import { createSqliteUserDataStore } from "../privacy/userDataStore.js";
import { createTursoSyncRepositories } from "../turso/tursoSyncRepositories.js";
import { createTursoRepositories, type StorageRepositories } from "./storageRepositories.js";

export type StorageConfig = {
  preferenceStore?: string;
  databasePath?: string;
  tursoDatabaseUrl?: string;
  tursoAuthToken?: string;
  tursoSyncPath?: string;
};

export type Storage = StorageRepositories & { close(): Promise<void> };

/**
 * Select defaults once. Overrides replace only the named repository; they never
 * influence the backend of the remaining defaults. Callers supplying custom
 * repositories are responsible for their compatibility with account erasure.
 * Opening a selected backend fails at startup rather than swapping databases.
 */
export function createStorage(
  config: StorageConfig = {},
  overrides: Partial<StorageRepositories> = {},
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
  let tursoRepositories: StorageRepositories | undefined;
  const turso = () => {
    if (!tursoRepositories) {
      client = createClient({ url: config.tursoDatabaseUrl ?? "", authToken: config.tursoAuthToken });
      tursoRepositories = createTursoRepositories(client);
    }
    return tursoRepositories;
  };
  async function close() {
    database?.close();
    client?.close();
  }

  try {
    if (store === "turso-sync" && (
      !overrides.preferenceRepository || !overrides.userRepository || !overrides.inviteRepository
      || !overrides.chatSessionRepository || overrides.userDataStore === undefined
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
      userDataStore: overrides.userDataStore !== undefined ? overrides.userDataStore : (
        store === "turso" ? turso().userDataStore
          : store === "memory" ? null
            : createSqliteUserDataStore({ db: sqlite() })
      ),
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
  const repositories = await createTursoSyncRepositories({
    ...config,
    tursoSyncPath: config.tursoSyncPath ?? "bandsearch-sync.db",
  });
  return { ...repositories, close: () => repositories.client.close() };
}

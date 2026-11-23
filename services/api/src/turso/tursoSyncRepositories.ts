import { createTursoSyncClient } from "./tursoSyncClient.js";
import type { TursoSyncClient } from "./tursoSyncClient.js";
import { createTursoRepositories, type StorageRepositories } from "../storage/storageRepositories.js";

// Builds the repository set for PREFERENCE_STORE=turso-sync.
//
// It lives outside createApp because opening the local replica is asynchronous
// and createApp is not; openStorage awaits this and server.ts passes the complete
// storage set to createApp. PREFERENCE_STORE=turso still goes straight to the
// cloud on every statement.
//
// One client serves all account repositories on purpose: they share a database,
// and a second client would mean a second replica file and a second sync loop
// racing the first.

export type TursoSyncRepositoriesOptions = {
  tursoSyncPath: string;
  tursoDatabaseUrl?: string;
  tursoAuthToken?: string;
  syncIntervalMs?: number;
  logger?: { warn: (entry: Record<string, unknown>) => void };
};

export type TursoSyncRepositories = StorageRepositories & { client: TursoSyncClient };

export async function createTursoSyncRepositories({
  tursoSyncPath,
  tursoDatabaseUrl,
  tursoAuthToken,
  syncIntervalMs,
  logger,
}: TursoSyncRepositoriesOptions): Promise<TursoSyncRepositories> {
  const client = await createTursoSyncClient({
    path: tursoSyncPath,
    url: tursoDatabaseUrl,
    authToken: tursoAuthToken,
    syncIntervalMs,
    logger,
  });

  // Bring the replica up to date before serving the first request, so a restart
  // does not answer from a stale local copy.
  await client.sync();

  return { client, ...createTursoRepositories(client) };
}

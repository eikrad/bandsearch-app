import { createTursoSyncClient } from "./tursoSyncClient.js";
import type { TursoSyncClient } from "./tursoSyncClient.js";
import { createTursoPreferenceRepository } from "../preferences/tursoPreferenceRepository.js";
import { createTursoUserRepository } from "../auth/tursoUserRepository.js";
import { createTursoChatSessionRepository } from "../sessions/tursoChatSessionRepository.js";
import type { PreferenceRepository } from "../preferences/preferenceRepository.js";

// Builds the repository set for PREFERENCE_STORE=turso-sync.
//
// It lives outside createApp because opening the local replica is asynchronous
// and createApp is not; server.ts awaits this and injects the result through
// the repository options createApp already has. That keeps the sync path from
// changing anything for PREFERENCE_STORE=turso, which still goes straight to
// the cloud on every statement.
//
// One client serves all three repositories on purpose: they share a database,
// and a second client would mean a second replica file and a second sync loop
// racing the first.

export type TursoSyncRepositoriesOptions = {
  tursoSyncPath: string;
  tursoDatabaseUrl?: string;
  tursoAuthToken?: string;
  syncIntervalMs?: number;
  logger?: { warn: (entry: Record<string, unknown>) => void };
};

export type TursoSyncRepositories = {
  client: TursoSyncClient;
  preferenceRepository: PreferenceRepository;
  userRepository: ReturnType<typeof createTursoUserRepository>;
  chatSessionRepository: ReturnType<typeof createTursoChatSessionRepository>;
};

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

  return {
    client,
    preferenceRepository: createTursoPreferenceRepository({ client }),
    userRepository: createTursoUserRepository({ client }),
    chatSessionRepository: createTursoChatSessionRepository({ client }),
  };
}

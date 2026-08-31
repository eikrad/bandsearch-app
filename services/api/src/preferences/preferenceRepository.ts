import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import { createInMemoryPreferenceRepository } from "./preferenceMemory.js";
import { createSqlitePreferenceRepository } from "./sqlitePreferenceRepository.js";
import { createTursoPreferenceRepository } from "./tursoPreferenceRepository.js";

export const POSTGRES_REMOVED_MESSAGE =
  "PREFERENCE_STORE=postgres is no longer supported — the Postgres adapter was removed "
  + "because it had no user scoping. Use PREFERENCE_STORE=turso (shared/cloud) or sqlite (local).";

type PragmaTableRow = { name: string };

function addColumnIfMissing(db: import("better-sqlite3").Database, table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as PragmaTableRow[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

type Group = { id: string; name: string; memberIds: string[] };

export type SavedBand = {
  id: string;
  musicbrainzArtistId: string;
  name: string;
  rating: number | null;
  categories: string[];
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type BandRepository = {
  addSavedBand: (input: unknown, userId?: string) => Promise<{ ok: boolean; error?: string; savedBand?: unknown }>;
  listSavedBands: (userId?: string) => Promise<SavedBand[]>;
  updateSavedBand: (id: string, updates: { rating?: number | null; categories?: string[]; note?: string }, userId?: string) => Promise<{ ok: boolean; error?: string; status?: number; savedBand?: unknown }>;
  deleteSavedBand: (id: string, userId?: string) => Promise<{ ok: boolean; error?: string; status?: number; deletedId?: string }>;
};

export type BandGroupRepository = {
  importSavedBands: (bands: unknown[], userId?: string) => Promise<{ imported: number; skipped: number; failed: number }>;
  listGroups: (userId?: string) => Promise<Group[]>;
  createGroup: (name: string, userId?: string) => Promise<{ ok: boolean; error?: string; status?: number; group?: Group }>;
  renameGroup: (id: string, name: string, userId?: string) => Promise<{ ok: boolean; error?: string; status?: number; group?: Group }>;
  deleteGroup: (id: string, userId?: string) => Promise<{ ok: boolean; error?: string; status?: number; deletedId?: string }>;
  addArtistToGroup: (groupId: string, savedBandId: string, userId?: string) => Promise<{ ok: boolean; error?: string; status?: number }>;
  removeArtistFromGroup: (groupId: string, savedBandId: string, userId?: string) => Promise<{ ok: boolean; error?: string; status?: number }>;
};

/**
 * What one storage backend provides. Each adapter speaks to a single database,
 * so it implements both halves — splitting the adapters into separate modules
 * would not change that, and would only mean two files per backend instead of one.
 *
 * The separation that matters is on the consuming side: nothing should hold all
 * eleven methods just because they arrive together. Use `splitPreferenceRepository`
 * and pass on the half a caller actually needs.
 */
export type PreferenceRepository = BandRepository & BandGroupRepository;

const BAND_REPOSITORY_METHODS = [
  "addSavedBand",
  "listSavedBands",
  "updateSavedBand",
  "deleteSavedBand",
] as const;

const BAND_GROUP_REPOSITORY_METHODS = [
  "importSavedBands",
  "listGroups",
  "createGroup",
  "renameGroup",
  "deleteGroup",
  "addArtistToGroup",
  "removeArtistFromGroup",
] as const;

function assertMethods(repository: unknown, methodNames: readonly string[]) {
  for (const methodName of methodNames) {
    if (typeof (repository as Record<string, unknown>)?.[methodName] !== "function") {
      throw new Error(`invalid preference repository: missing method ${methodName}`);
    }
  }
}

export function assertBandRepository(repository: unknown): BandRepository {
  assertMethods(repository, BAND_REPOSITORY_METHODS);
  return repository as BandRepository;
}

export function assertBandGroupRepository(repository: unknown): BandGroupRepository {
  assertMethods(repository, BAND_GROUP_REPOSITORY_METHODS);
  return repository as BandGroupRepository;
}

export function assertPreferenceRepository(repository: unknown): PreferenceRepository {
  assertMethods(repository, [...BAND_REPOSITORY_METHODS, ...BAND_GROUP_REPOSITORY_METHODS]);
  return repository as PreferenceRepository;
}

/**
 * Two narrow views on one backend, so callers declare the half they use.
 *
 * Both views are the same object — this is about what a consumer's type says it
 * may call, not about isolating instances.
 */
export function splitPreferenceRepository(
  repository: unknown,
): { bands: BandRepository; groups: BandGroupRepository } {
  return {
    bands: assertBandRepository(repository),
    groups: assertBandGroupRepository(repository),
  };
}

export const TURSO_SYNC_ASYNC_MESSAGE =
  "PREFERENCE_STORE=turso-sync cannot be built here: opening the local replica is "
  + "asynchronous. Use createTursoSyncRepositories() from turso/tursoSyncRepositories.js "
  + "and pass the repositories into createApp().";

type PreferenceConfig = {
  preferenceStore?: string;
  databasePath?: string;
  tursoDatabaseUrl?: string;
  tursoAuthToken?: string;
};

export function createPreferenceRepository(runtimeConfig: PreferenceConfig = {}): PreferenceRepository {
  // Removed backend. Falling through to the SQLite default would silently swap
  // the database of a deployment that still sets this, so refuse instead.
  if (runtimeConfig.preferenceStore === "postgres") {
    throw new Error(POSTGRES_REMOVED_MESSAGE);
  }
  // Same reasoning as above: silently returning SQLite would hand the caller a
  // different database than the one they asked for.
  if (runtimeConfig.preferenceStore === "turso-sync") {
    throw new Error(TURSO_SYNC_ASYNC_MESSAGE);
  }
  if (runtimeConfig.preferenceStore === "turso") {
    const client = createClient({
      url: runtimeConfig.tursoDatabaseUrl ?? "",
      authToken: runtimeConfig.tursoAuthToken,
    });
    return createTursoPreferenceRepository({ client });
  }
  if (runtimeConfig.preferenceStore === "memory") {
    return createInMemoryPreferenceRepository();
  }
  // Default: SQLite — persistent, zero-config, works everywhere
  const db = new Database(runtimeConfig.databasePath || "bandsearch.db");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_bands (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'anonymous',
      musicbrainz_artist_id TEXT NOT NULL,
      name TEXT NOT NULL,
      -- Nullable: a band can be saved before the user has judged it.
      rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
      categories TEXT NOT NULL DEFAULT '[]',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS artist_groups (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'anonymous',
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS artist_group_members (
      group_id TEXT NOT NULL REFERENCES artist_groups(id) ON DELETE CASCADE,
      saved_band_id TEXT NOT NULL REFERENCES saved_bands(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL,
      PRIMARY KEY (group_id, saved_band_id)
    );
  `);
  addColumnIfMissing(db, "saved_bands", "user_id", "TEXT NOT NULL DEFAULT 'anonymous'");
  addColumnIfMissing(db, "artist_groups", "user_id", "TEXT NOT NULL DEFAULT 'anonymous'");
  return createSqlitePreferenceRepository({ db });
}

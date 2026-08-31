import type { SavedBand } from "../preferences/preferenceRepository.js";

/**
 * Everything the app holds about one person, in one place.
 *
 * GDPR Art. 15/17/20 all ask the same question — "what do you hold about this
 * person?" — so export and erasure are deliberately one module over one table
 * list. Split apart, the Art. 15 export drifts out of step with the Art. 17
 * erasure the first time a table is added to one and not the other.
 *
 * There are intentionally no foreign keys behind this. SQLite enforces them
 * only when `foreign_keys=ON`, which is per-connection and set on exactly one
 * of this app's connections, while libSQL enforces by default — so a cascade
 * would fire on Turso and silently not fire on SQLite. Explicit deletes are
 * the only construction that behaves identically on both backends.
 */

export type UserScopedTable = {
  /** Table name, as it appears in the schema. */
  table: string;
  /** WHERE clause that selects exactly this user's rows, with one `?` per bind. */
  where: string;
  /** How many times `userId` must be bound into `where`. */
  binds: number;
};

/**
 * The auditable list of every table holding personal data, in delete order.
 *
 * `users` is last so that a run which dies partway leaves a still-valid account
 * that can simply be erased again, rather than an account whose row is gone
 * while its data survives unreachable.
 *
 * `recommendation_events` is deliberately absent: it has no `user_id` and is
 * never linked to one, which is good data minimisation. It is covered by
 * retention rather than erasure.
 *
 * A test walks the real schema and fails if a table gains a `user_id` column
 * without being added here.
 */
export const USER_SCOPED_TABLES: readonly UserScopedTable[] = [
  {
    table: "artist_group_members",
    where: `group_id IN (SELECT id FROM artist_groups WHERE user_id = ?)
            OR saved_band_id IN (SELECT id FROM saved_bands WHERE user_id = ?)`,
    binds: 2,
  },
  {
    table: "chat_messages",
    where: "session_id IN (SELECT id FROM chat_sessions WHERE user_id = ?)",
    binds: 1,
  },
  { table: "saved_bands", where: "user_id = ?", binds: 1 },
  { table: "artist_groups", where: "user_id = ?", binds: 1 },
  { table: "chat_sessions", where: "user_id = ?", binds: 1 },
  { table: "recommendation_feedback", where: "user_id = ?", binds: 1 },
  { table: "users", where: "id = ?", binds: 1 },
];

export type ExportedUser = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
};

export type ExportedChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: { id: string; role: string; content: string; createdAt: string }[];
};

export type ExportedGroup = { id: string; name: string; memberIds: string[] };

export type ExportedFeedback = {
  id: string;
  eventId: string;
  feedbackType: string;
  createdAt: string;
};

export type UserDataExport = {
  format: "bandsearch-account-export/1";
  exportedAt: string;
  user: ExportedUser | null;
  savedBands: SavedBand[];
  artistGroups: ExportedGroup[];
  chatSessions: ExportedChatSession[];
  recommendationFeedback: ExportedFeedback[];
};

export type UserDataStore = {
  exportUserData(userId: string): Promise<UserDataExport>;
  /** Deletes every row this user owns. Returns rows removed per table. */
  eraseUserData(userId: string): Promise<Record<string, number>>;
};

/** Columns selected explicitly, so the bcrypt hashes cannot leak into an export. */
const USER_EXPORT_COLUMNS = "id, email, display_name, created_at";

export function rowToExportedUser(row: Record<string, unknown>): ExportedUser {
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: String(row.display_name),
    createdAt: String(row.created_at),
  };
}

export function rowToSavedBand(row: Record<string, unknown>): SavedBand {
  return {
    id: String(row.id),
    musicbrainzArtistId: String(row.musicbrainz_artist_id),
    name: String(row.name),
    // Number(null) is 0 — a rating the user never gave, in their own data
    // export. An absent rating has to stay absent.
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
    categories: parseCategories(row.categories),
    note: String(row.note ?? ""),
    noteEdited: Boolean(Number(row.note_edited ?? 0)),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function parseCategories(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function emptyExport(): UserDataExport {
  return {
    format: "bandsearch-account-export/1",
    exportedAt: new Date().toISOString(),
    user: null,
    savedBands: [],
    artistGroups: [],
    chatSessions: [],
    recommendationFeedback: [],
  };
}

export function createSqliteUserDataStore({ db }: { db: import("better-sqlite3").Database }): UserDataStore {
  // Eval tables only exist where the eval dashboard was enabled at some point,
  // so a table list is resolved per call rather than assumed.
  const tableExists = (name: string) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;

  return {
    exportUserData(userId) {
      const bundle = emptyExport();
      if (!tableExists("users")) return Promise.resolve(bundle);

      const userRow = db
        .prepare(`SELECT ${USER_EXPORT_COLUMNS} FROM users WHERE id = ?`)
        .get(userId) as Record<string, unknown> | undefined;
      if (!userRow) return Promise.resolve(bundle);
      bundle.user = rowToExportedUser(userRow);

      if (tableExists("saved_bands")) {
        const rows = db
          .prepare("SELECT * FROM saved_bands WHERE user_id = ? ORDER BY updated_at DESC")
          .all(userId) as Record<string, unknown>[];
        bundle.savedBands = rows.map(rowToSavedBand);
      }

      if (tableExists("artist_groups")) {
        const groups = db
          .prepare("SELECT id, name FROM artist_groups WHERE user_id = ? ORDER BY name ASC")
          .all(userId) as Record<string, unknown>[];
        bundle.artistGroups = groups.map((g) => {
          const memberIds = tableExists("artist_group_members")
            ? (db
                .prepare("SELECT saved_band_id FROM artist_group_members WHERE group_id = ?")
                .all(String(g.id)) as Record<string, unknown>[]).map((m) => String(m.saved_band_id))
            : [];
          return { id: String(g.id), name: String(g.name), memberIds };
        });
      }

      if (tableExists("chat_sessions")) {
        const sessions = db
          .prepare("SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC")
          .all(userId) as Record<string, unknown>[];
        // One query for every message, then grouped in memory — a query per
        // session would be a network round-trip each on the Turso adapter.
        const messages = tableExists("chat_messages")
          ? (db
              .prepare(
                `SELECT * FROM chat_messages
                 WHERE session_id IN (SELECT id FROM chat_sessions WHERE user_id = ?)
                 ORDER BY created_at ASC`,
              )
              .all(userId) as Record<string, unknown>[])
          : [];
        bundle.chatSessions = sessions.map((s) => ({
          id: String(s.id),
          title: String(s.title),
          createdAt: String(s.created_at),
          updatedAt: String(s.updated_at),
          messages: messages
            .filter((m) => String(m.session_id) === String(s.id))
            .map((m) => ({
              id: String(m.id),
              role: String(m.role),
              content: String(m.content),
              createdAt: String(m.created_at),
            })),
        }));
      }

      if (tableExists("recommendation_feedback")) {
        const rows = db
          .prepare("SELECT * FROM recommendation_feedback WHERE user_id = ? ORDER BY created_at ASC")
          .all(userId) as Record<string, unknown>[];
        bundle.recommendationFeedback = rows.map((r) => ({
          id: String(r.id),
          eventId: String(r.event_id),
          feedbackType: String(r.feedback_type),
          createdAt: String(r.created_at),
        }));
      }

      return Promise.resolve(bundle);
    },

    eraseUserData(userId) {
      const erased: Record<string, number> = {};
      const runAll = db.transaction((id: string) => {
        for (const { table, where, binds } of USER_SCOPED_TABLES) {
          if (!tableExists(table)) continue;
          const result = db.prepare(`DELETE FROM ${table} WHERE ${where}`).run(...Array(binds).fill(id));
          erased[table] = result.changes;
        }
      });
      runAll(userId);
      return Promise.resolve(erased);
    },
  };
}

import type { TursoClient, TursoStatement } from "../turso/tursoClient.js";
import type { UserDataStore, ExportedChatSession } from "./userDataStore.js";
import {
  USER_SCOPED_TABLES,
  emptyExport,
  rowToExportedUser,
  rowToSavedBand,
} from "./userDataStore.js";

/**
 * The Turso half of the user data store.
 *
 * Both adapters build their statements from the same `USER_SCOPED_TABLES`
 * constant, which is what keeps the two backends from drifting apart — the one
 * failure mode a foreign-key cascade could not have prevented here, since
 * SQLite would not have enforced it on the connection this runs on.
 *
 * Turso always has the full schema (`002_full_schema.sql` creates every table),
 * so unlike the SQLite adapter there is no need to probe for absent tables.
 */
export function createTursoUserDataStore({ client }: { client: TursoClient }): UserDataStore {
  return {
    async exportUserData(userId) {
      const bundle = emptyExport();

      const userResult = await client.execute({
        // Columns listed explicitly so the bcrypt hashes cannot leak into an export.
        sql: "SELECT id, email, display_name, created_at FROM users WHERE id = ?",
        args: [userId],
      });
      if (userResult.rows.length === 0) return bundle;
      bundle.user = rowToExportedUser(userResult.rows[0]);

      const [bands, groups, members, sessions, messages, feedback] = await client.batch(
        [
          { sql: "SELECT * FROM saved_bands WHERE user_id = ? ORDER BY updated_at DESC", args: [userId] },
          { sql: "SELECT id, name FROM artist_groups WHERE user_id = ? ORDER BY name ASC", args: [userId] },
          {
            sql: `SELECT group_id, saved_band_id FROM artist_group_members
                  WHERE group_id IN (SELECT id FROM artist_groups WHERE user_id = ?)`,
            args: [userId],
          },
          { sql: "SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC", args: [userId] },
          {
            // One query for all messages rather than one per session: on Turso
            // each statement is a network round-trip.
            sql: `SELECT * FROM chat_messages
                  WHERE session_id IN (SELECT id FROM chat_sessions WHERE user_id = ?)
                  ORDER BY created_at ASC`,
            args: [userId],
          },
          {
            sql: "SELECT * FROM recommendation_feedback WHERE user_id = ? ORDER BY created_at ASC",
            args: [userId],
          },
        ],
        "read",
      );

      bundle.savedBands = bands.rows.map(rowToSavedBand);
      bundle.artistGroups = groups.rows.map((g) => ({
        id: String(g.id),
        name: String(g.name),
        memberIds: members.rows
          .filter((m) => String(m.group_id) === String(g.id))
          .map((m) => String(m.saved_band_id)),
      }));
      bundle.chatSessions = sessions.rows.map<ExportedChatSession>((s) => ({
        id: String(s.id),
        title: String(s.title),
        createdAt: String(s.created_at),
        updatedAt: String(s.updated_at),
        messages: messages.rows
          .filter((m) => String(m.session_id) === String(s.id))
          .map((m) => ({
            id: String(m.id),
            role: String(m.role),
            content: String(m.content),
            createdAt: String(m.created_at),
          })),
      }));
      bundle.recommendationFeedback = feedback.rows.map((r) => ({
        id: String(r.id),
        eventId: String(r.event_id),
        feedbackType: String(r.feedback_type),
        createdAt: String(r.created_at),
      }));

      return bundle;
    },

    async eraseUserData(userId) {
      const statements: TursoStatement[] = USER_SCOPED_TABLES.map(({ table, where, binds }) => ({
        sql: `DELETE FROM ${table} WHERE ${where}`,
        args: Array<string>(binds).fill(userId),
      }));

      // "write" makes the batch a single transaction: either every table is
      // cleared or none is. `users` is last, so a failed run leaves an account
      // that can simply be erased again.
      const results = await client.batch(statements, "write");

      const erased: Record<string, number> = {};
      USER_SCOPED_TABLES.forEach(({ table }, i) => {
        erased[table] = results[i]?.rowsAffected ?? 0;
      });
      return erased;
    },
  };
}

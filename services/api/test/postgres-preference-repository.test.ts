import test from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { createPostgresPreferenceRepository } from "../src/preferences/postgresPreferenceRepository.js";
import { assertRecord } from "./helpers/typeAssertions.js";

type QueryCall = { sql: string; params?: unknown[] };
type QueryResultLike = { rows: unknown[]; rowCount: number };

// The repository only ever calls `pool.query`; standing up the rest of pg.Pool
// would be noise, so the narrowing lives here rather than at each call site.
function fakePool(onQuery: (call: QueryCall) => QueryResultLike): Pool {
  return {
    query: async (sql: string, params?: unknown[]) => onQuery({ sql, params }),
  } as unknown as Pool;
}

test("postgres repository creates and maps saved band rows", async () => {
  const calls: QueryCall[] = [];
  const repository = createPostgresPreferenceRepository({
    pool: fakePool((call) => {
      calls.push(call);
      return {
        rows: [
          {
            id: "pref-1",
            musicbrainz_artist_id: "a1",
            name: "Fen",
            rating: 4,
            categories: ["post-black"],
            note: "Atmospheric",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
        ],
        rowCount: 1,
      };
    }),
  });

  const result = await repository.addSavedBand({
    musicbrainzArtistId: "a1",
    name: "Fen",
    rating: 4,
    categories: ["post-black"],
    note: "Atmospheric",
  });

  assert.equal(result.ok, true);
  assertRecord(result.savedBand);
  assert.equal(result.savedBand.name, "Fen");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sql.includes("INSERT INTO saved_bands"), true);
});

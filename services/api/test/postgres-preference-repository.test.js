const test = require("node:test");
const assert = require("node:assert/strict");

const { createPostgresPreferenceRepository } = require("../src/preferences/postgresPreferenceRepository");

test("postgres repository creates and maps saved band rows", async () => {
  const calls = [];
  const repository = createPostgresPreferenceRepository({
    pool: {
      query: async (sql, params) => {
        calls.push({ sql, params });
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
      },
    },
  });

  const result = await repository.addSavedBand({
    musicbrainzArtistId: "a1",
    name: "Fen",
    rating: 4,
    categories: ["post-black"],
    note: "Atmospheric",
  });

  assert.equal(result.ok, true);
  assert.equal(result.savedBand.name, "Fen");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sql.includes("INSERT INTO saved_bands"), true);
});

import test from "node:test";
import assert from "node:assert/strict";
import type { Client as LibSQLClient } from "@libsql/client";
import { createTursoPreferenceRepository as createRepository } from "../src/preferences/tursoPreferenceRepository.js";
import { assertRecord } from "./helpers/typeAssertions.js";
import { buildSavedBandContext } from "../src/savedBandContext.js";

type ExecutedStatement = { sql: string; args?: unknown[] };

function createTursoPreferenceRepository(options: { client: unknown }) {
  return createRepository({ client: options.client as LibSQLClient });
}

function makeRow(overrides = {}) {
  return {
    id: "t-1",
    musicbrainz_artist_id: "mb-1",
    name: "Alcest",
    rating: 5,
    categories: '["blackgaze","shoegaze"]',
    note: "Beautiful",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("turso repository adds and maps a saved band", async () => {
  const calls: ExecutedStatement[] = [];
  const repo = createTursoPreferenceRepository({
    client: {
      execute: async (stmt: ExecutedStatement) => {
        calls.push(stmt);
        // addSavedBand checks for an existing row (musicbrainzArtistId, #163)
        // before inserting; an empty result here means "not found yet".
        if (stmt.sql.includes("SELECT")) return { rows: [], rowsAffected: 0 };
        return { rows: [makeRow()], rowsAffected: 1 };
      },
    },
  });

  const result = await repo.addSavedBand({
    musicbrainzArtistId: "mb-1",
    name: "Alcest",
    rating: 5,
    categories: ["blackgaze", "shoegaze"],
    note: "Beautiful",
  });

  assert.equal(result.ok, true);
  assertRecord(result.savedBand);
  assert.equal(result.savedBand.name, "Alcest");
  assert.equal(result.savedBand.rating, 5);
  assert.deepEqual(result.savedBand.categories, ["blackgaze", "shoegaze"]);
  assert.equal(result.savedBand.note, "Beautiful");
  assert.ok(result.savedBand.id, "id must be set");
  assert.ok(result.savedBand.createdAt, "createdAt must be set");
  assert.equal(calls.length, 2, "a dedup SELECT, then the INSERT");
  assert.ok(calls[0].sql.includes("SELECT"), "must check for an existing row first");
  assert.ok(calls[1].sql.includes("INSERT INTO saved_bands"), "must issue INSERT when none exists");
});

test("turso repository updates rather than duplicates when the artist is already saved", async () => {
  const calls: ExecutedStatement[] = [];
  const existingRow = makeRow({ id: "t-1", rating: 3 });
  const repo = createTursoPreferenceRepository({
    client: {
      execute: async (stmt: ExecutedStatement) => {
        calls.push(stmt);
        if (stmt.sql.startsWith("SELECT")) return { rows: [existingRow], rowsAffected: 0 };
        return { rows: [makeRow({ id: "t-1", rating: 5 })], rowsAffected: 1 };
      },
    },
  });

  const result = await repo.addSavedBand({
    musicbrainzArtistId: "mb-1",
    name: "Alcest",
    rating: 5,
    categories: ["blackgaze", "shoegaze"],
    note: "Beautiful",
  });

  assert.equal(result.ok, true);
  assertRecord(result.savedBand);
  assert.equal(result.savedBand.id, "t-1", "must update the existing row, not create a new one");
  assert.equal(calls.length, 2, "a dedup SELECT, then an UPDATE — no INSERT");
  assert.ok(calls[1].sql.includes("UPDATE saved_bands"), "must issue UPDATE when the artist already exists");
});

test("turso repository rejects invalid input without calling client", async () => {
  const repo = createTursoPreferenceRepository({
    client: {
      execute: async () => {
        throw new Error("should not be called");
      },
    },
  });

  const result = await repo.addSavedBand({ name: "Alcest" });
  assert.equal(result.ok, false);
});

test("turso repository lists all saved bands", async () => {
  const rows = [
    makeRow({ id: "t-1", name: "Alcest", rating: 5 }),
    makeRow({ id: "t-2", musicbrainz_artist_id: "mb-2", name: "Fen", rating: 4, categories: "[]" }),
  ];

  const repo = createTursoPreferenceRepository({
    client: { execute: async () => ({ rows, rowsAffected: 0 }) },
  });

  const bands = await repo.listSavedBands();
  assert.equal(bands.length, 2);
  assertRecord(bands[0]);
  assertRecord(bands[1]);
  assert.equal(bands[0].name, "Alcest");
  assert.equal(bands[1].name, "Fen");
});

test("turso repository updates a saved band", async () => {
  const currentRow = makeRow({ rating: 3, note: "" });
  const updatedRow = makeRow({ rating: 5, note: "Essential", updated_at: "2026-02-01T00:00:00.000Z" });

  let call = 0;
  const repo = createTursoPreferenceRepository({
    client: {
      execute: async () => {
        call++;
        return call === 1
          ? { rows: [currentRow], rowsAffected: 0 }
          : { rows: [updatedRow], rowsAffected: 1 };
      },
    },
  });

  const result = await repo.updateSavedBand("t-1", { rating: 5, note: "Essential" });
  assert.equal(result.ok, true);
  assertRecord(result.savedBand);
  assert.equal(result.savedBand.rating, 5);
  assert.equal(result.savedBand.note, "Essential");
  assert.deepEqual(result.savedBand.categories, ["blackgaze", "shoegaze"]);
});

test("turso repository returns 404 for unknown update id", async () => {
  const repo = createTursoPreferenceRepository({
    client: { execute: async () => ({ rows: [], rowsAffected: 0 }) },
  });

  const result = await repo.updateSavedBand("does-not-exist", { rating: 4 });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test("turso repository deletes a saved band", async () => {
  const repo = createTursoPreferenceRepository({
    client: { execute: async () => ({ rows: [], rowsAffected: 1 }) },
  });

  const result = await repo.deleteSavedBand("t-1");
  assert.equal(result.ok, true);
  assert.equal(result.deletedId, "t-1");
});

test("turso repository returns 404 for unknown delete id", async () => {
  const repo = createTursoPreferenceRepository({
    client: { execute: async () => ({ rows: [], rowsAffected: 0 }) },
  });

  const result = await repo.deleteSavedBand("does-not-exist");
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test("turso repository builds preference context from saved bands", async () => {
  const rows = [
    makeRow({
      name: "Sunn O)))",
      rating: 5,
      categories: '["drone","metal"]',
      note: "Transcendent",
    }),
  ];

  const repo = createTursoPreferenceRepository({
    client: { execute: async () => ({ rows, rowsAffected: 0 }) },
  });

  const context = await buildSavedBandContext(repo);
  assert.ok(context.includes("Sunn O)))"), "context must include band name");
  assert.ok(context.includes("5/5"), "context must include rating");
});

test("turso repository returns empty string context when no bands saved", async () => {
  const repo = createTursoPreferenceRepository({
    client: { execute: async () => ({ rows: [], rowsAffected: 0 }) },
  });

  const context = await buildSavedBandContext(repo);
  assert.equal(context, "");
});

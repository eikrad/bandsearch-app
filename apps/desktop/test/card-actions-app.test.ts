import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapDesktopApp } from "../src/bootstrapDesktopApp.js";
import { jsonResponse } from "./helpers/fakeResponse.js";
import { withSearchJobs } from "./helpers/fakeSearchJobApi.js";
import type { SavedBand } from "../src/domain.js";

/**
 * A small stand-in server: tracks saved bands by id, and resolves POST as
 * create-or-update on musicbrainzArtistId the same way the real API does
 * (#163), so rateBand/saveCategoryNote's lookups are exercised against
 * realistic responses rather than hand-picked fixtures.
 */
function appWithFakeServer(initialBands: SavedBand[] = [], firstSaveDelayMs = 0) {
  const bands = new Map<string, Record<string, unknown>>(initialBands.map((band) => [band.id, { ...band }]));
  let nextId = 1;
  let nextRecommendations: Array<{ artist: string; musicbrainzArtistId?: string; why?: string }> = [];
  const patched: Array<{ id: string; body: Record<string, unknown> }> = [];
  let createCount = 0;

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};

    if (String(url).endsWith("/preferences") && method === "GET") {
      return jsonResponse({ savedBands: [...bands.values()] });
    }

    if (String(url).endsWith("/preferences") && method === "POST") {
      if (createCount++ === 0 && firstSaveDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, firstSaveDelayMs));
      }
      const existing = [...bands.values()].find((b) => b.musicbrainzArtistId === body.musicbrainzArtistId);
      if (existing) {
        Object.assign(existing, { name: body.name, rating: body.rating ?? null, categories: body.categories, note: body.note });
        return jsonResponse({ savedBand: existing });
      }
      const id = `b${nextId++}`;
      const savedBand = {
        id,
        musicbrainzArtistId: body.musicbrainzArtistId,
        name: body.name,
        rating: body.rating ?? null,
        categories: body.categories || [],
        note: body.note || "",
        noteEdited: false,
      };
      bands.set(id, savedBand);
      return jsonResponse({ savedBand });
    }

    const patchMatch = String(url).match(/\/preferences\/([^/]+)$/);
    if (patchMatch && method === "PATCH") {
      const id = patchMatch[1];
      patched.push({ id, body });
      const existing = bands.get(id);
      if (!existing) return jsonResponse({ error: { code: "not_found" } }, { status: 404 });
      Object.assign(existing, body);
      if (body.note !== undefined) existing.noteEdited = true;
      return jsonResponse({ savedBand: existing });
    }

    if (String(url).endsWith("/recommendations")) {
      return jsonResponse({ recommendations: nextRecommendations, meta: {} });
    }

    return jsonResponse({});
  }) as unknown as typeof fetch;

  const app = bootstrapDesktopApp({ apiBaseUrl: "http://api.test", fetchImpl: withSearchJobs(fetchImpl) });

  /** Runs a query so the given cards land in state.messages, as a real search would. */
  async function seedRecommendations(recommendations: typeof nextRecommendations) {
    nextRecommendations = recommendations;
    await app.requestRecommendations("some query", "fresh");
  }

  return { app, bands, patched, seedRecommendations };
}

test("rateBand finds the saved band by musicbrainzArtistId, not name — two artists sharing a name do not collide", async () => {
  const { app, patched, seedRecommendations } = appWithFakeServer();
  await seedRecommendations([{ artist: "Odessa", musicbrainzArtistId: "mb-odessa-1" }]);
  await app.saveBand({ name: "Odessa", musicbrainzArtistId: "mb-odessa-1" });

  await seedRecommendations([{ artist: "Odessa", musicbrainzArtistId: "mb-odessa-2" }]);
  const secondSaved = await app.saveBand({ name: "Odessa", musicbrainzArtistId: "mb-odessa-2" });

  await app.rateBand({ name: "Odessa", musicbrainzArtistId: "mb-odessa-2" }, 4);

  const lastPatch = patched[patched.length - 1];
  assert.equal(
    lastPatch.id,
    secondSaved.id,
    "must rate the artist referenced by the selected card, not the first same-named one",
  );
});

test("rateBand with rating null clears the rating but leaves the band saved", async () => {
  const { app, bands, seedRecommendations } = appWithFakeServer();
  await seedRecommendations([{ artist: "Codeine", musicbrainzArtistId: "mb-codeine" }]);
  const saved = await app.rateBand({ name: "Codeine", musicbrainzArtistId: "mb-codeine" }, 4);

  await app.rateBand({ name: "Codeine", musicbrainzArtistId: "mb-codeine" }, null);

  assert.equal(bands.get(saved.id)?.rating, null);
  assert.ok(bands.has(saved.id), "the band must still be saved, only unrated");
});

test("saveCategoryNote updates an existing saved band via artist identity", async () => {
  const { app, patched, seedRecommendations } = appWithFakeServer();
  await seedRecommendations([{ artist: "Fen", musicbrainzArtistId: "mb-fen" }]);
  const saved = await app.saveBand({ name: "Fen", musicbrainzArtistId: "mb-fen" });

  await app.saveCategoryNote({ name: "Fen", musicbrainzArtistId: "mb-fen" }, { categories: ["atmospheric"], note: "My own words" });

  assert.equal(patched.length, 1);
  assert.equal(patched[0].id, saved.id);
  assert.deepEqual(patched[0].body, { categories: ["atmospheric"], note: "My own words" });
});

test("saveCategoryNote creates a saved band when the artist is not saved yet", async () => {
  const { app, bands, seedRecommendations } = appWithFakeServer();
  await seedRecommendations([{ artist: "Alcest", musicbrainzArtistId: "mb-alcest" }]);

  const result = await app.saveCategoryNote({ name: "Alcest", musicbrainzArtistId: "mb-alcest" }, { categories: ["shoegaze"], note: "First impression" });

  assert.ok(bands.has(result.id));
  assert.deepEqual(bands.get(result.id)?.categories, ["shoegaze"]);
  assert.equal(bands.get(result.id)?.note, "First impression");
});

test("saving a repeated recommendation preserves the saved band's annotations", async () => {
  const { app, seedRecommendations } = appWithFakeServer();
  const target = { name: "Fen", musicbrainzArtistId: "mb-fen", suggestedNote: "First recommendation." };
  await app.saveBand(target);
  await app.saveCategoryNote(target, { categories: ["atmospheric"], note: "My own listening notes." });
  const annotated = await app.rateBand(target, 4);
  await seedRecommendations([{ artist: "Fen", musicbrainzArtistId: "mb-fen", why: "A new explanation." }]);

  const savedAgain = await app.saveBand({ ...target, suggestedNote: "A new explanation." });

  assert.deepEqual(savedAgain, annotated);
});

test("cards without a MusicBrainz ID share saved-band identity by normalized name", async () => {
  const { app } = appWithFakeServer();
  const saved = await app.saveBand({ name: "Codeine", suggestedNote: "An older recommendation." });

  const rated = await app.rateBand({ name: "  CODEINE  " }, 3);

  assert.equal(rated.id, saved.id);
  assert.equal(rated.musicbrainzArtistId, "local-codeine");
  assert.equal(rated.note, "An older recommendation.");
  assert.equal(app.getState().savedBands.length, 1);
});

test("saving before the collection has loaded preserves existing stored annotations", async () => {
  const existing: SavedBand = {
    id: "saved-fen", name: "Fen", musicbrainzArtistId: "mb-fen",
    rating: 5, categories: ["favourite"], note: "My listening notes.", noteEdited: true,
  };
  const { app } = appWithFakeServer([existing]);

  const saved = await app.saveBand({ name: "Fen", musicbrainzArtistId: "mb-fen", suggestedNote: "New rationale." });

  assert.deepEqual(saved, existing);
});

test("a slow Save followed by Rate keeps the user's chosen rating", async () => {
  const { app } = appWithFakeServer([], 20);
  const target = { name: "Fen", musicbrainzArtistId: "mb-fen", suggestedNote: "An atmospheric pick." };

  await Promise.all([app.saveBand(target), app.rateBand(target, 4)]);

  assert.equal(app.getState().savedBands.length, 1);
  assert.equal(app.getState().savedBands[0].rating, 4);
  assert.equal(app.getState().savedBands[0].note, "An atmospheric pick.");
});

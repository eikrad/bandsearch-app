import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapDesktopApp } from "../src/bootstrapDesktopApp.js";
import { jsonResponse } from "./helpers/fakeResponse.js";

/**
 * A small stand-in server: tracks saved bands by id, and resolves POST as
 * create-or-update on musicbrainzArtistId the same way the real API does
 * (#163), so rateBand/saveCategoryNote's lookups are exercised against
 * realistic responses rather than hand-picked fixtures.
 */
function appWithFakeServer() {
  const bands = new Map<string, Record<string, unknown>>();
  let nextId = 1;
  let nextRecommendations: Array<{ artist: string; musicbrainzArtistId?: string; why?: string }> = [];
  const patched: Array<{ id: string; body: Record<string, unknown> }> = [];

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};

    if (String(url).endsWith("/preferences") && method === "POST") {
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
      return jsonResponse({ savedBand: existing });
    }

    if (String(url).endsWith("/recommendations")) {
      return jsonResponse({ recommendations: nextRecommendations, meta: {} });
    }

    return jsonResponse({});
  }) as unknown as typeof fetch;

  const app = bootstrapDesktopApp({ apiBaseUrl: "http://api.test", fetchImpl });

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
  await app.saveBand("Odessa");

  await seedRecommendations([{ artist: "Odessa", musicbrainzArtistId: "mb-odessa-2" }]);
  const secondSaved = await app.saveBand("Odessa");

  await app.rateBand("Odessa", 4);

  const lastPatch = patched[patched.length - 1];
  assert.equal(
    lastPatch.id,
    secondSaved.id,
    "must rate the artist actually referenced by the latest card, not the first same-named one",
  );
});

test("rateBand with rating null clears the rating but leaves the band saved", async () => {
  const { app, bands, seedRecommendations } = appWithFakeServer();
  await seedRecommendations([{ artist: "Codeine", musicbrainzArtistId: "mb-codeine" }]);
  const saved = await app.saveBand("Codeine", { rating: 4 });

  await app.rateBand("Codeine", null);

  assert.equal(bands.get(saved.id)?.rating, null);
  assert.ok(bands.has(saved.id), "the band must still be saved, only unrated");
});

test("saveCategoryNote updates an existing saved band via its id", async () => {
  const { app, patched, seedRecommendations } = appWithFakeServer();
  await seedRecommendations([{ artist: "Fen", musicbrainzArtistId: "mb-fen" }]);
  const saved = await app.saveBand("Fen");

  await app.saveCategoryNote("Fen", saved.id, { categories: ["atmospheric"], note: "My own words" });

  assert.equal(patched.length, 1);
  assert.equal(patched[0].id, saved.id);
  assert.deepEqual(patched[0].body, { categories: ["atmospheric"], note: "My own words" });
});

test("saveCategoryNote creates a saved band when the artist has no savedBandId yet", async () => {
  const { app, bands, seedRecommendations } = appWithFakeServer();
  await seedRecommendations([{ artist: "Alcest", musicbrainzArtistId: "mb-alcest" }]);

  const result = await app.saveCategoryNote("Alcest", null, { categories: ["shoegaze"], note: "First impression" });

  assert.ok(bands.has(result.id));
  assert.deepEqual(bands.get(result.id)?.categories, ["shoegaze"]);
  assert.equal(bands.get(result.id)?.note, "First impression");
});

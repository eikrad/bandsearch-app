import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { createPreferenceRepository } from "../src/preferences/preferenceRepository.js";
import { assertArray, assertRecord } from "./helpers/typeAssertions.js";

function freshApp() {
  return createApp({ preferenceRepository: createPreferenceRepository({ preferenceStore: "memory" }) });
}

async function makeRequest(app: ReturnType<typeof freshApp>, method: string, path: string, payload?: unknown) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = await response.json();
    return { status: response.status, data };
  } finally {
    server.close();
  }
}

async function makeRawRequest(app: ReturnType<typeof freshApp>, method: string, path: string, payload?: unknown) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = await response.json();
    return { status: response.status, data, headers: response.headers };
  } finally {
    server.close();
  }
}

test("POST /preferences stores a saved band", async () => {
  const app = freshApp();
  const result = await makeRequest(app, "POST", "/preferences", {
    musicbrainzArtistId: "a1",
    name: "Alcest",
    rating: 5,
    categories: ["blackgaze", "atmospheric"],
    note: "Love the dreamy guitars and melancholic vocals.",
  });

  assert.equal(result.status, 201);
  assertRecord(result.data);
  assertRecord(result.data.savedBand);
  assert.equal(result.data.savedBand.name, "Alcest");
  assertArray(result.data.savedBand.categories);
  assert.equal(result.data.savedBand.categories.length, 2);
});

test("POST /preferences rejects invalid rating", async () => {
  const app = freshApp();
  const result = await makeRequest(app, "POST", "/preferences", {
    musicbrainzArtistId: "a1",
    name: "Alcest",
    rating: 9,
    categories: ["blackgaze"],
    note: "Invalid rating test.",
  });

  assert.equal(result.status, 400);
  assertRecord(result.data);
  assertRecord(result.data.error);
  assert.equal(result.data.error.code, "validation_error");
  assert.equal(result.data.error.message, "rating must be an integer between 1 and 5");
});

test("GET /preferences/context returns condensed preference context", async () => {
  const app = freshApp();
  await makeRequest(app, "POST", "/preferences", {
    musicbrainzArtistId: "a1",
    name: "Alcest",
    rating: 5,
    categories: ["blackgaze"],
    note: "Dreamy and melancholic atmosphere.",
  });

  const result = await makeRequest(app, "GET", "/preferences/context");
  assert.equal(result.status, 200);
  assertRecord(result.data);
  assert.equal(typeof result.data.context, "string");
  assert.ok(typeof result.data.context === "string");
  assert.equal(result.data.context.includes("Alcest"), true);
});

test("GET /preferences returns all saved bands", async () => {
  const app = freshApp();
  await makeRequest(app, "POST", "/preferences", {
    musicbrainzArtistId: "a1",
    name: "Alcest",
    rating: 5,
    categories: ["blackgaze"],
    note: "Dreamy and melancholic atmosphere.",
  });

  await makeRequest(app, "POST", "/preferences", {
    musicbrainzArtistId: "a2",
    name: "Fen",
    rating: 4,
    categories: ["post-metal"],
    note: "Love the long atmospheric builds.",
  });

  const result = await makeRequest(app, "GET", "/preferences");
  assert.equal(result.status, 200);
  assertRecord(result.data);
  assertArray(result.data.savedBands);
  assert.equal(result.data.savedBands.length, 2);
});

test("PATCH /preferences/:id updates saved band fields", async () => {
  const app = freshApp();
  const created = await makeRequest(app, "POST", "/preferences", {
    musicbrainzArtistId: "a1",
    name: "Alcest",
    rating: 5,
    categories: ["blackgaze"],
    note: "Dreamy and melancholic atmosphere.",
  });
  assertRecord(created.data);
  assertRecord(created.data.savedBand);

  const result = await makeRequest(app, "PATCH", `/preferences/${created.data.savedBand.id}`, {
    rating: 4,
    categories: ["blackgaze", "shoegaze"],
    note: "Still love it, now prefer the softer tracks.",
  });

  assert.equal(result.status, 200);
  assertRecord(result.data);
  assertRecord(result.data.savedBand);
  assert.equal(result.data.savedBand.rating, 4);
  assertArray(result.data.savedBand.categories);
  assert.equal(result.data.savedBand.categories.length, 2);
  assert.ok(typeof result.data.savedBand.note === "string");
  assert.equal(result.data.savedBand.note.includes("softer"), true);
});

test("PATCH /preferences/:id returns 404 for unknown id", async () => {
  const app = freshApp();
  const result = await makeRequest(app, "PATCH", "/preferences/does-not-exist", {
    rating: 4,
  });

  assert.equal(result.status, 404);
  assertRecord(result.data);
  assertRecord(result.data.error);
  assert.equal(result.data.error.code, "preference_update_failed");
  assert.equal(result.data.error.message, "saved band not found");
});

test("DELETE /preferences/:id removes a saved band", async () => {
  const app = freshApp();
  const created = await makeRequest(app, "POST", "/preferences", {
    musicbrainzArtistId: "a1",
    name: "Alcest",
    rating: 5,
    categories: ["blackgaze"],
    note: "Dreamy and melancholic atmosphere.",
  });
  assertRecord(created.data);
  assertRecord(created.data.savedBand);

  const deletion = await makeRequest(
    app,
    "DELETE",
    `/preferences/${created.data.savedBand.id}`,
  );
  assert.equal(deletion.status, 200);
  assertRecord(deletion.data);
  assert.equal(deletion.data.deletedId, created.data.savedBand.id);

  const list = await makeRequest(app, "GET", "/preferences");
  assert.equal(list.status, 200);
  assertRecord(list.data);
  assertArray(list.data.savedBands);
  assert.equal(list.data.savedBands.length, 0);
});

test("DELETE /preferences/:id returns 404 for unknown id", async () => {
  const app = freshApp();
  const result = await makeRequest(app, "DELETE", "/preferences/does-not-exist");

  assert.equal(result.status, 404);
  assertRecord(result.data);
  assertRecord(result.data.error);
  assert.equal(result.data.error.code, "preference_delete_failed");
  assert.equal(result.data.error.message, "saved band not found");
});

test("GET /preferences/export returns all saved bands as JSON attachment", async () => {
  const app = freshApp();
  await makeRequest(app, "POST", "/preferences", {
    musicbrainzArtistId: "a1",
    name: "Alcest",
    rating: 5,
    categories: ["blackgaze"],
    note: "Dreamy.",
  });

  const result = await makeRawRequest(app, "GET", "/preferences/export");

  assert.equal(result.status, 200);
  assertArray(result.data);
  assert.equal(result.data.length, 1);
  assertRecord(result.data[0]);
  assert.equal(result.data[0].name, "Alcest");
  assert.equal(
    result.headers.get("content-disposition")?.includes("attachment"),
    true,
    "should set Content-Disposition: attachment",
  );
});

test("POST /preferences/import inserts new bands and returns counts", async () => {
  const app = freshApp();
  const result = await makeRequest(app, "POST", "/preferences/import", [
    { musicbrainzArtistId: "b1", name: "Fen", rating: 4, categories: ["post-metal"], note: "" },
    { musicbrainzArtistId: "b2", name: "Alcest", rating: 5, categories: ["blackgaze"], note: "Dreamy." },
  ]);

  assert.equal(result.status, 200);
  assertRecord(result.data);
  assert.equal(result.data.imported, 2);
  assert.equal(result.data.skipped, 0);

  const list = await makeRequest(app, "GET", "/preferences");
  assertRecord(list.data);
  assertArray(list.data.savedBands);
  assert.equal(list.data.savedBands.length, 2);
});

test("POST /preferences/import skips artists that already exist by musicbrainzArtistId", async () => {
  const app = freshApp();
  await makeRequest(app, "POST", "/preferences", {
    musicbrainzArtistId: "a1",
    name: "Alcest",
    rating: 5,
    categories: ["blackgaze"],
    note: "Already saved.",
  });

  const result = await makeRequest(app, "POST", "/preferences/import", [
    { musicbrainzArtistId: "a1", name: "Alcest", rating: 3, categories: [], note: "Should be skipped." },
    { musicbrainzArtistId: "b2", name: "Fen", rating: 4, categories: ["post-metal"], note: "" },
  ]);

  assert.equal(result.status, 200);
  assertRecord(result.data);
  assert.equal(result.data.imported, 1);
  assert.equal(result.data.skipped, 1);

  const list = await makeRequest(app, "GET", "/preferences");
  assertRecord(list.data);
  assertArray(list.data.savedBands);
  assert.equal(list.data.savedBands.length, 2);
  const alcest = list.data.savedBands.find((band) => {
    assertRecord(band);
    return band.musicbrainzArtistId === "a1";
  });
  assertRecord(alcest);
  assert.equal(alcest.rating, 5, "existing record should not be overwritten");
});

test("POST /preferences/import rejects non-array body", async () => {
  const app = freshApp();
  const result = await makeRequest(app, "POST", "/preferences/import", { not: "an array" });

  assert.equal(result.status, 400);
  assertRecord(result.data);
  assertRecord(result.data.error);
  assert.equal(result.data.error.code, "validation_error");
});

const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");

async function makeRequest(app, method, path, payload) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;

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

test("POST /preferences stores a saved band", async () => {
  const app = createApp();
  const result = await makeRequest(app, "POST", "/preferences", {
    musicbrainzArtistId: "a1",
    name: "Alcest",
    rating: 5,
    categories: ["blackgaze", "atmospheric"],
    note: "Love the dreamy guitars and melancholic vocals.",
  });

  assert.equal(result.status, 201);
  assert.equal(result.data.savedBand.name, "Alcest");
  assert.equal(result.data.savedBand.categories.length, 2);
});

test("POST /preferences rejects invalid rating", async () => {
  const app = createApp();
  const result = await makeRequest(app, "POST", "/preferences", {
    musicbrainzArtistId: "a1",
    name: "Alcest",
    rating: 9,
    categories: ["blackgaze"],
    note: "Invalid rating test.",
  });

  assert.equal(result.status, 400);
  assert.equal(result.data.error, "rating must be an integer between 1 and 5");
});

test("GET /preferences/context returns condensed preference context", async () => {
  const app = createApp();
  await makeRequest(app, "POST", "/preferences", {
    musicbrainzArtistId: "a1",
    name: "Alcest",
    rating: 5,
    categories: ["blackgaze"],
    note: "Dreamy and melancholic atmosphere.",
  });

  const result = await makeRequest(app, "GET", "/preferences/context");
  assert.equal(result.status, 200);
  assert.equal(typeof result.data.context, "string");
  assert.equal(result.data.context.includes("Alcest"), true);
});

test("GET /preferences returns all saved bands", async () => {
  const app = createApp();
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
  assert.equal(Array.isArray(result.data.savedBands), true);
  assert.equal(result.data.savedBands.length, 2);
});

test("PATCH /preferences/:id updates saved band fields", async () => {
  const app = createApp();
  const created = await makeRequest(app, "POST", "/preferences", {
    musicbrainzArtistId: "a1",
    name: "Alcest",
    rating: 5,
    categories: ["blackgaze"],
    note: "Dreamy and melancholic atmosphere.",
  });

  const result = await makeRequest(app, "PATCH", `/preferences/${created.data.savedBand.id}`, {
    rating: 4,
    categories: ["blackgaze", "shoegaze"],
    note: "Still love it, now prefer the softer tracks.",
  });

  assert.equal(result.status, 200);
  assert.equal(result.data.savedBand.rating, 4);
  assert.equal(result.data.savedBand.categories.length, 2);
  assert.equal(result.data.savedBand.note.includes("softer"), true);
});

test("PATCH /preferences/:id returns 404 for unknown id", async () => {
  const app = createApp();
  const result = await makeRequest(app, "PATCH", "/preferences/does-not-exist", {
    rating: 4,
  });

  assert.equal(result.status, 404);
  assert.equal(result.data.error, "saved band not found");
});

test("DELETE /preferences/:id removes a saved band", async () => {
  const app = createApp();
  const created = await makeRequest(app, "POST", "/preferences", {
    musicbrainzArtistId: "a1",
    name: "Alcest",
    rating: 5,
    categories: ["blackgaze"],
    note: "Dreamy and melancholic atmosphere.",
  });

  const deletion = await makeRequest(
    app,
    "DELETE",
    `/preferences/${created.data.savedBand.id}`,
  );
  assert.equal(deletion.status, 200);
  assert.equal(deletion.data.deletedId, created.data.savedBand.id);

  const list = await makeRequest(app, "GET", "/preferences");
  assert.equal(list.status, 200);
  assert.equal(list.data.savedBands.length, 0);
});

test("DELETE /preferences/:id returns 404 for unknown id", async () => {
  const app = createApp();
  const result = await makeRequest(app, "DELETE", "/preferences/does-not-exist");

  assert.equal(result.status, 404);
  assert.equal(result.data.error, "saved band not found");
});

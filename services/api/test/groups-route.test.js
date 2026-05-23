const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");
const { createPreferenceRepository } = require("../src/preferences/preferenceRepository");

function freshApp(musicBrainzClient) {
  return createApp({
    preferenceRepository: createPreferenceRepository({ preferenceStore: "memory" }),
    ...(musicBrainzClient ? { musicBrainzClient } : {}),
  });
}

async function req(app, method, path, payload) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
    const data = await response.json();
    return { status: response.status, data };
  } finally {
    server.close();
  }
}

test("GET /preferences/groups returns empty array initially", async () => {
  const app = freshApp();
  const result = await req(app, "GET", "/preferences/groups");

  assert.equal(result.status, 200);
  assert.deepEqual(result.data.groups, []);
});

test("POST /preferences/groups creates a group", async () => {
  const app = freshApp();
  const result = await req(app, "POST", "/preferences/groups", { name: "Blackgaze" });

  assert.equal(result.status, 201);
  assert.equal(result.data.group.name, "Blackgaze");
  assert.ok(result.data.group.id, "group should have an id");
  assert.deepEqual(result.data.group.memberIds, []);
});

test("POST /preferences/groups rejects blank name", async () => {
  const app = freshApp();
  const result = await req(app, "POST", "/preferences/groups", { name: "  " });

  assert.equal(result.status, 400);
  assert.equal(result.data.error.code, "validation_error");
});

test("POST /preferences/groups rejects duplicate group name", async () => {
  const app = freshApp();
  await req(app, "POST", "/preferences/groups", { name: "Blackgaze" });
  const result = await req(app, "POST", "/preferences/groups", { name: "Blackgaze" });

  assert.equal(result.status, 409);
  assert.equal(result.data.error.code, "group_name_conflict");
});

test("PATCH /preferences/groups/:id renames a group", async () => {
  const app = freshApp();
  const created = await req(app, "POST", "/preferences/groups", { name: "Blackgaze" });
  const id = created.data.group.id;

  const result = await req(app, "PATCH", `/preferences/groups/${id}`, { name: "Shoegaze" });

  assert.equal(result.status, 200);
  assert.equal(result.data.group.name, "Shoegaze");
});

test("PATCH /preferences/groups/:id returns 404 for unknown group", async () => {
  const app = freshApp();
  const result = await req(app, "PATCH", "/preferences/groups/no-such-id", { name: "X" });

  assert.equal(result.status, 404);
});

test("DELETE /preferences/groups/:id deletes a group", async () => {
  const app = freshApp();
  const created = await req(app, "POST", "/preferences/groups", { name: "Post-metal" });
  const id = created.data.group.id;

  const deletion = await req(app, "DELETE", `/preferences/groups/${id}`);
  assert.equal(deletion.status, 200);
  assert.equal(deletion.data.deletedId, id);

  const list = await req(app, "GET", "/preferences/groups");
  assert.equal(list.data.groups.length, 0);
});

test("DELETE /preferences/groups/:id returns 404 for unknown group", async () => {
  const app = freshApp();
  const result = await req(app, "DELETE", "/preferences/groups/no-such-id");

  assert.equal(result.status, 404);
});

test("POST /preferences/groups/:id/artists adds saved band to group", async () => {
  const app = freshApp();

  const band = await req(app, "POST", "/preferences", {
    musicbrainzArtistId: "mb-a1",
    name: "Alcest",
    rating: 5,
    categories: [],
    note: "",
  });
  const bandId = band.data.savedBand.id;

  const group = await req(app, "POST", "/preferences/groups", { name: "Blackgaze" });
  const groupId = group.data.group.id;

  const result = await req(app, "POST", `/preferences/groups/${groupId}/artists`, { savedBandId: bandId });
  assert.equal(result.status, 200);

  const list = await req(app, "GET", "/preferences/groups");
  const g = list.data.groups.find((g) => g.id === groupId);
  assert.equal(g.memberIds.includes(bandId), true);
});

test("DELETE /preferences/groups/:id/artists/:savedBandId removes band from group", async () => {
  const app = freshApp();

  const band = await req(app, "POST", "/preferences", {
    musicbrainzArtistId: "mb-a1",
    name: "Alcest",
    rating: 5,
    categories: [],
    note: "",
  });
  const bandId = band.data.savedBand.id;

  const group = await req(app, "POST", "/preferences/groups", { name: "Blackgaze" });
  const groupId = group.data.group.id;

  await req(app, "POST", `/preferences/groups/${groupId}/artists`, { savedBandId: bandId });
  const removal = await req(app, "DELETE", `/preferences/groups/${groupId}/artists/${bandId}`);
  assert.equal(removal.status, 200);

  const list = await req(app, "GET", "/preferences/groups");
  const g = list.data.groups.find((g) => g.id === groupId);
  assert.deepEqual(g.memberIds, []);
});

test("POST /preferences/groups/auto creates genre-based groups from saved bands", async () => {
  const mbClient = {
    searchArtists: async () => [],
    lookupArtist: async (mbid) => {
      const genreMap = {
        "mb-alcest": ["blackgaze", "shoegaze"],
        "mb-fen": ["post-metal", "atmospheric black metal"],
        "mb-wolves": ["black metal"],
      };
      return { id: mbid, name: mbid, tags: [], genres: genreMap[mbid] || [], urls: [], lifeSpan: {} };
    },
  };

  const app = freshApp(mbClient);

  await req(app, "POST", "/preferences", { musicbrainzArtistId: "mb-alcest", name: "Alcest", rating: 5, categories: [], note: "" });
  await req(app, "POST", "/preferences", { musicbrainzArtistId: "mb-fen", name: "Fen", rating: 4, categories: [], note: "" });
  await req(app, "POST", "/preferences", { musicbrainzArtistId: "mb-wolves", name: "Wolves in the Throne Room", rating: 5, categories: [], note: "" });

  const result = await req(app, "POST", "/preferences/groups/auto");
  assert.equal(result.status, 200);
  assert.ok(Array.isArray(result.data.groups), "should return groups array");

  const groupNames = result.data.groups.map((g) => g.name);
  assert.ok(groupNames.includes("blackgaze"), "should create blackgaze group");
  assert.ok(groupNames.includes("post-metal"), "should create post-metal group");

  const blackgazeGroup = result.data.groups.find((g) => g.name === "blackgaze");
  assert.ok(blackgazeGroup.memberIds.length > 0, "blackgaze group should have members");
});

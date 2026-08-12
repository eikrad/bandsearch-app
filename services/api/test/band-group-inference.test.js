const test = require("node:test");
const assert = require("node:assert/strict");
const { inferAndApplyGroupAssignments } = require("../src/preferences/bandGroupInference");

function makeContext({ lookupArtist, createGroup, addArtistToGroup } = {}) {
  return {
    lookupArtist: lookupArtist ?? (async () => ({ genres: [] })),
    createGroup: createGroup ?? (async (name) => ({ ok: true, group: { id: `id-${name}`, name } })),
    addArtistToGroup: addArtistToGroup ?? (async () => ({ ok: true })),
  };
}

test("happy path: band with MBID creates group and adds member", async () => {
  const addArtistToGroup = test.mock.fn(async () => ({ ok: true }));
  const createGroup = test.mock.fn(async (name) => ({ ok: true, group: { id: `id-${name}`, name } }));

  await inferAndApplyGroupAssignments(
    [{ id: "band-1", musicbrainzArtistId: "mb-1" }],
    [],
    makeContext({
      lookupArtist: async () => ({ genres: ["metal"] }),
      createGroup,
      addArtistToGroup,
    }),
    "user-1",
  );

  assert.equal(createGroup.mock.calls.length, 1, "createGroup called once");
  assert.equal(createGroup.mock.calls[0].arguments[0], "metal");
  assert.equal(createGroup.mock.calls[0].arguments[1], "user-1");
  assert.equal(addArtistToGroup.mock.calls.length, 1, "addArtistToGroup called once");
  assert.equal(addArtistToGroup.mock.calls[0].arguments[1], "band-1");
});

test("silent MusicBrainz failure: band is skipped, createGroup not called", async () => {
  const createGroup = test.mock.fn(async (name) => ({ ok: true, group: { id: `id-${name}`, name } }));

  await inferAndApplyGroupAssignments(
    [{ id: "band-1", musicbrainzArtistId: "mb-1" }],
    [],
    makeContext({
      lookupArtist: async () => { throw new Error("network error"); },
      createGroup,
    }),
  );

  assert.equal(createGroup.mock.calls.length, 0, "createGroup should not be called after lookup failure");
});

test("no MBID: band is skipped entirely", async () => {
  const lookupArtist = test.mock.fn(async () => ({ genres: ["metal"] }));
  const createGroup = test.mock.fn(async (name) => ({ ok: true, group: { id: `id-${name}`, name } }));

  await inferAndApplyGroupAssignments(
    [{ id: "band-1", musicbrainzArtistId: null }],
    [],
    makeContext({ lookupArtist, createGroup }),
  );

  assert.equal(lookupArtist.mock.calls.length, 0, "lookupArtist should not be called without MBID");
  assert.equal(createGroup.mock.calls.length, 0, "createGroup should not be called without MBID");
});

test("existing group reuse: no createGroup call, addArtistToGroup still called", async () => {
  const existingGroup = { id: "existing-id", name: "metal" };
  const createGroup = test.mock.fn(async (name) => ({ ok: true, group: { id: `id-${name}`, name } }));
  const addArtistToGroup = test.mock.fn(async () => ({ ok: true }));

  await inferAndApplyGroupAssignments(
    [{ id: "band-1", musicbrainzArtistId: "mb-1" }],
    [existingGroup],
    makeContext({
      lookupArtist: async () => ({ genres: ["metal"] }),
      createGroup,
      addArtistToGroup,
    }),
  );

  assert.equal(createGroup.mock.calls.length, 0, "createGroup should not be called for existing group");
  assert.equal(addArtistToGroup.mock.calls.length, 1, "addArtistToGroup should still be called");
  assert.equal(addArtistToGroup.mock.calls[0].arguments[0], "existing-id");
});

test("race condition: createGroup returns ok:false, genre is skipped (no addArtistToGroup)", async () => {
  const addArtistToGroup = test.mock.fn(async () => ({ ok: true }));

  await inferAndApplyGroupAssignments(
    [{ id: "band-1", musicbrainzArtistId: "mb-1" }],
    [],
    makeContext({
      lookupArtist: async () => ({ genres: ["metal"] }),
      createGroup: async () => ({ ok: false }),
      addArtistToGroup,
    }),
  );

  assert.equal(addArtistToGroup.mock.calls.length, 0, "addArtistToGroup should not be called when createGroup fails");
});

test("multiple genres: creates two groups and two memberships", async () => {
  const createGroup = test.mock.fn(async (name) => ({ ok: true, group: { id: `id-${name}`, name } }));
  const addArtistToGroup = test.mock.fn(async () => ({ ok: true }));

  await inferAndApplyGroupAssignments(
    [{ id: "band-1", musicbrainzArtistId: "mb-1" }],
    [],
    makeContext({
      lookupArtist: async () => ({ genres: ["metal", "doom"] }),
      createGroup,
      addArtistToGroup,
    }),
  );

  assert.equal(createGroup.mock.calls.length, 2, "two groups created");
  assert.equal(addArtistToGroup.mock.calls.length, 2, "band added to both groups");
});

test("no genres: lookupArtist returns empty array, no groups created", async () => {
  const createGroup = test.mock.fn(async (name) => ({ ok: true, group: { id: `id-${name}`, name } }));
  const addArtistToGroup = test.mock.fn(async () => ({ ok: true }));

  await inferAndApplyGroupAssignments(
    [{ id: "band-1", musicbrainzArtistId: "mb-1" }],
    [],
    makeContext({
      lookupArtist: async () => ({ genres: [] }),
      createGroup,
      addArtistToGroup,
    }),
  );

  assert.equal(createGroup.mock.calls.length, 0, "no groups created for empty genres");
  assert.equal(addArtistToGroup.mock.calls.length, 0, "no memberships created for empty genres");
});

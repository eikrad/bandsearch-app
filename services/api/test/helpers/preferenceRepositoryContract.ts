import test from "node:test";
import assert from "node:assert/strict";

import type { PreferenceRepository, SavedBand } from "../../src/preferences/preferenceRepository.js";

/**
 * One behaviour suite, run against every storage adapter.
 *
 * The per-adapter test files cover the four BandRepository methods against their
 * own backend. This covers the seven BandGroupRepository methods, which no
 * adapter test exercised — `preference-repository-interfaces.test.ts` only ever
 * asserted that they exist. Group membership and import/export are user-facing
 * features, so they are worth pinning down on every backend rather than on the
 * in-memory stand-in alone.
 *
 * Adapters are handed in as a factory rather than an instance: several cases
 * need a repository with no prior state, and a shared one would couple them to
 * execution order.
 */
export type RepositoryFactory = () => PreferenceRepository | Promise<PreferenceRepository>;

const OTHER_USER = "user-b";

export function bandInput(overrides: Record<string, unknown> = {}) {
  return {
    musicbrainzArtistId: "mb-alcest",
    name: "Alcest",
    rating: 5,
    categories: ["blackgaze"],
    note: "Souvenirs d'un autre monde",
    ...overrides,
  };
}

/** Adds a band and returns it, failing the test if the adapter rejected it. */
async function addBand(
  repo: PreferenceRepository,
  overrides: Record<string, unknown> = {},
  userId?: string,
): Promise<SavedBand> {
  const result = await repo.addSavedBand(bandInput(overrides), userId);
  assert.equal(result.ok, true, `addSavedBand rejected a valid band: ${result.error ?? ""}`);
  return result.savedBand as SavedBand;
}

/** Creates a group and returns it, failing the test if the adapter rejected it. */
async function addGroup(repo: PreferenceRepository, name: string, userId?: string) {
  const result = await repo.createGroup(name, userId);
  assert.equal(result.ok, true, `createGroup rejected "${name}": ${result.error ?? ""}`);
  return result.group!;
}

export function runPreferenceRepositoryContract(adapterName: string, createRepository: RepositoryFactory) {
  const label = (name: string) => `[${adapterName}] ${name}`;

  // ---------------------------------------------------------------- import

  test(label("importSavedBands imports every valid band"), async () => {
    const repo = await createRepository();
    const result = await repo.importSavedBands([
      bandInput({ musicbrainzArtistId: "mb-1", name: "Fen" }),
      bandInput({ musicbrainzArtistId: "mb-2", name: "Altar of Plagues" }),
    ]);

    assert.deepEqual(result, { imported: 2, skipped: 0, failed: 0 });
    const stored = await repo.listSavedBands();
    assert.deepEqual(stored.map((b) => b.name).sort(), ["Altar of Plagues", "Fen"]);
  });

  test(label("importSavedBands skips bands already stored for this user"), async () => {
    const repo = await createRepository();
    await addBand(repo, { musicbrainzArtistId: "mb-1", name: "Fen" });

    const result = await repo.importSavedBands([
      bandInput({ musicbrainzArtistId: "mb-1", name: "Fen" }),
      bandInput({ musicbrainzArtistId: "mb-2", name: "Altar of Plagues" }),
    ]);

    assert.deepEqual(result, { imported: 1, skipped: 1, failed: 0 });
    assert.equal((await repo.listSavedBands()).length, 2);
  });

  test(label("importSavedBands deduplicates repeats within one payload"), async () => {
    const repo = await createRepository();
    const result = await repo.importSavedBands([
      bandInput({ musicbrainzArtistId: "mb-1", name: "Fen" }),
      bandInput({ musicbrainzArtistId: "mb-1", name: "Fen" }),
    ]);

    assert.deepEqual(result, { imported: 1, skipped: 1, failed: 0 });
    assert.equal((await repo.listSavedBands()).length, 1);
  });

  test(label("importSavedBands counts invalid bands as failed and keeps going"), async () => {
    const repo = await createRepository();
    const result = await repo.importSavedBands([
      bandInput({ musicbrainzArtistId: "mb-1", name: "Fen" }),
      // A rating outside 1-5. A *missing* rating used to stand in for "invalid"
      // here, but an unrated band is now a legitimate state (CONTEXT.md), so the
      // example had to become something genuinely rejectable.
      { musicbrainzArtistId: "mb-bad", name: "Bad Rating", rating: 9, categories: [], note: "" },
      bandInput({ musicbrainzArtistId: "mb-3", name: "Wolves in the Throne Room" }),
    ]);

    assert.deepEqual(result, { imported: 2, failed: 1, skipped: 0 });
    assert.equal((await repo.listSavedBands()).length, 2);
  });

  test(label("importSavedBands on an empty payload is a no-op"), async () => {
    const repo = await createRepository();
    assert.deepEqual(await repo.importSavedBands([]), { imported: 0, skipped: 0, failed: 0 });
  });

  test(label("importSavedBands scopes the skip check per user"), async () => {
    const repo = await createRepository();
    await addBand(repo, { musicbrainzArtistId: "mb-1", name: "Fen" });

    // The same artist is new to user-b, so it imports rather than skipping.
    const result = await repo.importSavedBands(
      [bandInput({ musicbrainzArtistId: "mb-1", name: "Fen" })],
      OTHER_USER,
    );

    assert.deepEqual(result, { imported: 1, skipped: 0, failed: 0 });
    assert.equal((await repo.listSavedBands()).length, 1);
    assert.equal((await repo.listSavedBands(OTHER_USER)).length, 1);
  });

  test(label("export then import round-trips through a second user"), async () => {
    const repo = await createRepository();
    await addBand(repo, { musicbrainzArtistId: "mb-1", name: "Fen", rating: 4 });
    await addBand(repo, { musicbrainzArtistId: "mb-2", name: "Alcest", rating: 5 });

    // What the export route hands the client, fed back in as an import.
    const exported = await repo.listSavedBands();
    const result = await repo.importSavedBands(exported, OTHER_USER);

    assert.deepEqual(result, { imported: 2, skipped: 0, failed: 0 });
    const reimported = await repo.listSavedBands(OTHER_USER);
    assert.deepEqual(
      reimported.map((b) => [b.name, b.rating, b.musicbrainzArtistId]).sort(),
      exported.map((b) => [b.name, b.rating, b.musicbrainzArtistId]).sort(),
    );
  });

  // ---------------------------------------------------------------- groups

  test(label("createGroup stores a group with no members"), async () => {
    const repo = await createRepository();
    const group = await addGroup(repo, "Blackgaze");

    assert.equal(group.name, "Blackgaze");
    assert.deepEqual(group.memberIds, []);
    assert.ok(group.id, "createGroup returned no id");
  });

  test(label("createGroup trims the name"), async () => {
    const repo = await createRepository();
    const group = await addGroup(repo, "  Blackgaze  ");

    assert.equal(group.name, "Blackgaze");
    assert.deepEqual((await repo.listGroups()).map((g) => g.name), ["Blackgaze"]);
  });

  test(label("createGroup rejects a blank name with 400"), async () => {
    const repo = await createRepository();
    const result = await repo.createGroup("   ");

    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.deepEqual(await repo.listGroups(), []);
  });

  test(label("createGroup rejects a duplicate name with 409"), async () => {
    const repo = await createRepository();
    await addGroup(repo, "Blackgaze");
    const result = await repo.createGroup("Blackgaze");

    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal((await repo.listGroups()).length, 1);
  });

  test(label("createGroup allows the same name for a different user"), async () => {
    const repo = await createRepository();
    await addGroup(repo, "Blackgaze");
    const result = await repo.createGroup("Blackgaze", OTHER_USER);

    assert.equal(result.ok, true);
    assert.equal((await repo.listGroups()).length, 1);
    assert.equal((await repo.listGroups(OTHER_USER)).length, 1);
  });

  test(label("listGroups returns only this user's groups, sorted by name"), async () => {
    const repo = await createRepository();
    await addGroup(repo, "Post-metal");
    await addGroup(repo, "Blackgaze");
    await addGroup(repo, "Doom", OTHER_USER);

    assert.deepEqual((await repo.listGroups()).map((g) => g.name), ["Blackgaze", "Post-metal"]);
    assert.deepEqual((await repo.listGroups(OTHER_USER)).map((g) => g.name), ["Doom"]);
  });

  test(label("renameGroup changes the name and keeps the members"), async () => {
    const repo = await createRepository();
    const band = await addBand(repo);
    const group = await addGroup(repo, "Blackgaze");
    await repo.addArtistToGroup(group.id, band.id);

    const result = await repo.renameGroup(group.id, "Blackgaze & Shoegaze");

    assert.equal(result.ok, true);
    assert.equal(result.group?.name, "Blackgaze & Shoegaze");
    assert.deepEqual(result.group?.memberIds, [band.id]);
    assert.deepEqual((await repo.listGroups())[0].memberIds, [band.id]);
  });

  test(label("renameGroup trims the new name"), async () => {
    const repo = await createRepository();
    const group = await addGroup(repo, "Blackgaze");

    const result = await repo.renameGroup(group.id, "  Shoegaze  ");

    assert.equal(result.group?.name, "Shoegaze");
  });

  test(label("renameGroup returns 404 for an unknown group"), async () => {
    const repo = await createRepository();
    const result = await repo.renameGroup("no-such-group", "Anything");

    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
  });

  test(label("renameGroup returns 400 for a blank name"), async () => {
    const repo = await createRepository();
    const group = await addGroup(repo, "Blackgaze");

    const result = await repo.renameGroup(group.id, "   ");

    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal((await repo.listGroups())[0].name, "Blackgaze");
  });

  test(label("renameGroup returns 409 when another group already has the name"), async () => {
    const repo = await createRepository();
    await addGroup(repo, "Blackgaze");
    const second = await addGroup(repo, "Post-metal");

    const result = await repo.renameGroup(second.id, "Blackgaze");

    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal((await repo.listGroups()).find((g) => g.id === second.id)?.name, "Post-metal");
  });

  test(label("renameGroup accepts a group's own name unchanged"), async () => {
    const repo = await createRepository();
    const group = await addGroup(repo, "Blackgaze");

    // The conflict check has to exclude the group being renamed, or a no-op
    // rename would collide with itself.
    const result = await repo.renameGroup(group.id, "Blackgaze");

    assert.equal(result.ok, true);
    assert.equal(result.group?.name, "Blackgaze");
  });

  test(label("renameGroup cannot rename another user's group"), async () => {
    const repo = await createRepository();
    const group = await addGroup(repo, "Blackgaze");

    const result = await repo.renameGroup(group.id, "Hijacked", OTHER_USER);

    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.equal((await repo.listGroups())[0].name, "Blackgaze");
  });

  test(label("deleteGroup removes the group"), async () => {
    const repo = await createRepository();
    const group = await addGroup(repo, "Blackgaze");

    const result = await repo.deleteGroup(group.id);

    assert.equal(result.ok, true);
    assert.equal(result.deletedId, group.id);
    assert.deepEqual(await repo.listGroups(), []);
  });

  test(label("deleteGroup returns 404 for an unknown group"), async () => {
    const repo = await createRepository();
    const result = await repo.deleteGroup("no-such-group");

    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
  });

  test(label("deleteGroup cannot delete another user's group"), async () => {
    const repo = await createRepository();
    const group = await addGroup(repo, "Blackgaze");

    const result = await repo.deleteGroup(group.id, OTHER_USER);

    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.equal((await repo.listGroups()).length, 1);
  });

  test(label("deleteGroup leaves the saved bands it contained"), async () => {
    const repo = await createRepository();
    const band = await addBand(repo);
    const group = await addGroup(repo, "Blackgaze");
    await repo.addArtistToGroup(group.id, band.id);

    await repo.deleteGroup(group.id);

    // Deleting a group must not cascade into the artists themselves.
    assert.deepEqual((await repo.listSavedBands()).map((b) => b.id), [band.id]);
  });

  // ------------------------------------------------------- group membership

  test(label("addArtistToGroup adds the artist to the group"), async () => {
    const repo = await createRepository();
    const band = await addBand(repo);
    const group = await addGroup(repo, "Blackgaze");

    const result = await repo.addArtistToGroup(group.id, band.id);

    assert.equal(result.ok, true);
    assert.deepEqual((await repo.listGroups())[0].memberIds, [band.id]);
  });

  test(label("addArtistToGroup is idempotent"), async () => {
    const repo = await createRepository();
    const band = await addBand(repo);
    const group = await addGroup(repo, "Blackgaze");

    await repo.addArtistToGroup(group.id, band.id);
    const second = await repo.addArtistToGroup(group.id, band.id);

    assert.equal(second.ok, true, "a repeat add must not error");
    assert.deepEqual((await repo.listGroups())[0].memberIds, [band.id]);
  });

  test(label("addArtistToGroup holds several artists"), async () => {
    const repo = await createRepository();
    const first = await addBand(repo, { musicbrainzArtistId: "mb-1", name: "Fen" });
    const second = await addBand(repo, { musicbrainzArtistId: "mb-2", name: "Alcest" });
    const group = await addGroup(repo, "Blackgaze");

    await repo.addArtistToGroup(group.id, first.id);
    await repo.addArtistToGroup(group.id, second.id);

    const members = (await repo.listGroups())[0].memberIds;
    assert.equal(members.length, 2);
    assert.deepEqual([...members].sort(), [first.id, second.id].sort());
  });

  test(label("addArtistToGroup returns 404 for an unknown group"), async () => {
    const repo = await createRepository();
    const band = await addBand(repo);

    const result = await repo.addArtistToGroup("no-such-group", band.id);

    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
  });

  test(label("addArtistToGroup cannot touch another user's group"), async () => {
    const repo = await createRepository();
    const band = await addBand(repo);
    const group = await addGroup(repo, "Blackgaze");

    const result = await repo.addArtistToGroup(group.id, band.id, OTHER_USER);

    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.deepEqual((await repo.listGroups())[0].memberIds, []);
  });

  test(label("removeArtistFromGroup removes the artist"), async () => {
    const repo = await createRepository();
    const band = await addBand(repo);
    const group = await addGroup(repo, "Blackgaze");
    await repo.addArtistToGroup(group.id, band.id);

    const result = await repo.removeArtistFromGroup(group.id, band.id);

    assert.equal(result.ok, true);
    assert.deepEqual((await repo.listGroups())[0].memberIds, []);
  });

  test(label("removeArtistFromGroup leaves the other members alone"), async () => {
    const repo = await createRepository();
    const first = await addBand(repo, { musicbrainzArtistId: "mb-1", name: "Fen" });
    const second = await addBand(repo, { musicbrainzArtistId: "mb-2", name: "Alcest" });
    const group = await addGroup(repo, "Blackgaze");
    await repo.addArtistToGroup(group.id, first.id);
    await repo.addArtistToGroup(group.id, second.id);

    await repo.removeArtistFromGroup(group.id, first.id);

    assert.deepEqual((await repo.listGroups())[0].memberIds, [second.id]);
  });

  test(label("removeArtistFromGroup succeeds for an artist that was never a member"), async () => {
    const repo = await createRepository();
    const group = await addGroup(repo, "Blackgaze");

    const result = await repo.removeArtistFromGroup(group.id, "never-a-member");

    assert.equal(result.ok, true, "removing a non-member must not error");
  });

  test(label("removeArtistFromGroup returns 404 for an unknown group"), async () => {
    const repo = await createRepository();
    const band = await addBand(repo);

    const result = await repo.removeArtistFromGroup("no-such-group", band.id);

    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
  });

  test(label("removeArtistFromGroup cannot touch another user's group"), async () => {
    const repo = await createRepository();
    const band = await addBand(repo);
    const group = await addGroup(repo, "Blackgaze");
    await repo.addArtistToGroup(group.id, band.id);

    const result = await repo.removeArtistFromGroup(group.id, band.id, OTHER_USER);

    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.deepEqual((await repo.listGroups())[0].memberIds, [band.id]);
  });

  test(label("deleting a saved band drops it from the groups holding it"), async () => {
    const repo = await createRepository();
    const band = await addBand(repo);
    const group = await addGroup(repo, "Blackgaze");
    await repo.addArtistToGroup(group.id, band.id);

    await repo.deleteSavedBand(band.id);

    // Otherwise listGroups reports members that no longer exist, and the client
    // renders a group of ghosts.
    assert.deepEqual((await repo.listGroups())[0].memberIds, []);
  });
}

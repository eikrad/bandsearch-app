import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTursoSyncRepositories } from "../src/turso/tursoSyncRepositories.js";

// Drives the real repositories over the real sync engine, with no url so the
// replica stays local and no network is involved. This is the check the unit
// tests cannot make: that `tursoPreferenceRepository` and friends — written
// against `@libsql/client`'s result shape — still behave on the sync client.

const migrationsDir = path.join(__dirname, "..", "migrations");

async function withRepositories<T>(
  fn: (repos: Awaited<ReturnType<typeof createTursoSyncRepositories>>) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "turso-sync-repos-"));
  const repos = await createTursoSyncRepositories({ tursoSyncPath: path.join(dir, "replica.db") });
  try {
    // Every migration, in order — not just 002 — so this stays the real
    // schema instead of quietly drifting behind whatever ships in production.
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const schema = await readFile(path.join(migrationsDir, file), "utf8");
      for (const statement of schema.split(";").map((s) => s.trim()).filter(Boolean)) {
        await repos.client.execute(statement);
      }
    }
    return await fn(repos);
  } finally {
    await repos.client.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("saved bands round-trip through the sync client", async () => {
  await withRepositories(async ({ preferenceRepository }) => {
    const created = await preferenceRepository.addSavedBand(
      { musicbrainzArtistId: "mb-1", name: "Codeine", rating: 5, categories: ["slowcore"], note: "sparse" },
      "user-1",
    );
    assert.equal(created.ok, true);

    const bands = await preferenceRepository.listSavedBands("user-1");
    assert.equal(bands.length, 1);
    assert.equal(bands[0].name, "Codeine");
    assert.deepEqual(bands[0].categories, ["slowcore"], "JSON columns must survive the round trip");
  });
});

test("user scoping holds on the sync client", async () => {
  await withRepositories(async ({ preferenceRepository }) => {
    await preferenceRepository.addSavedBand(
      { musicbrainzArtistId: "mb-1", name: "Codeine", rating: 5, categories: [], note: "" },
      "user-1",
    );

    assert.equal((await preferenceRepository.listSavedBands("user-2")).length, 0);
    assert.equal((await preferenceRepository.listSavedBands("user-1")).length, 1);
  });
});

// rowsAffected is how the repository tells "deleted" from "not found", and it is
// the one result field the sync client has to derive rather than pass through.
test("deleting a missing band reports not found rather than success", async () => {
  await withRepositories(async ({ preferenceRepository }) => {
    const created = await preferenceRepository.addSavedBand(
      { musicbrainzArtistId: "mb-1", name: "Codeine", rating: 5, categories: [], note: "" },
      "user-1",
    );
    const id = (created.savedBand as { id: string }).id;

    const missing = await preferenceRepository.deleteSavedBand("no-such-id", "user-1");
    assert.equal(missing.ok, false);
    assert.equal(missing.status, 404);

    const removed = await preferenceRepository.deleteSavedBand(id, "user-1");
    assert.equal(removed.ok, true);
    assert.equal((await preferenceRepository.listSavedBands("user-1")).length, 0);
  });
});

test("groups round-trip through the sync client", async () => {
  await withRepositories(async ({ preferenceRepository }) => {
    const group = await preferenceRepository.createGroup("Slowcore", "user-1");
    assert.equal(group.ok, true);

    const groups = await preferenceRepository.listGroups("user-1");
    assert.equal(groups.length, 1);
    assert.equal(groups[0].name, "Slowcore");
  });
});

// The batch path is only used by chat sessions, and it is where a RETURNING
// statement sits next to a plain UPDATE.
test("appending a chat message uses the batch path and returns the stored row", async () => {
  await withRepositories(async ({ chatSessionRepository }) => {
    const session = await chatSessionRepository.createSession({ title: "Test" }, "user-1");
    const sessionId = (session as { id: string }).id;

    const message = await chatSessionRepository.addMessage(sessionId, { role: "user", content: "hello" });

    assert.equal((message as { content: string }).content, "hello");
    const messages = await chatSessionRepository.getMessages(sessionId);
    assert.equal(messages.length, 1);
  });
});

test("users round-trip through the sync client", async () => {
  await withRepositories(async ({ userRepository }) => {
    const created = await userRepository.create({
      email: "Eikef@Example.com",
      displayName: "Eikef",
      passwordHash: "hash",
      recoveryCodeHash: "recovery",
    });
    assert.equal((created as { email: string }).email, "eikef@example.com", "email must be normalized on write");

    const found = await userRepository.findByEmail("eikef@example.com");
    assert.ok(found, "email lookup must be case-insensitive on this backend too");
  });
});

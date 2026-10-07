import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "../src/app.js";
import { createPreferenceRepository } from "../src/preferences/preferenceRepository.js";

// The only file default belongs to validateRuntimeEnv(), which server.ts always
// passes. Library-level fallbacks must not touch a file: the test runner's cwd
// is services/api, so a bare "bandsearch.db" there is the developer's real
// database, and every unconfigured test run used to write into it.
function inEmptyCwd(fn: () => void): string[] {
  const dir = mkdtempSync(join(tmpdir(), "bandsearch-cwd-"));
  const previous = process.cwd();
  process.chdir(dir);
  try {
    fn();
    return readdirSync(dir);
  } finally {
    process.chdir(previous);
    // Best effort: neither createApp() nor createPreferenceRepository() hands
    // out its SQLite handle, so the file stays open until garbage collection.
    // Windows refuses to delete a directory holding an open file (EPERM); the
    // OS clears the temp dir later, and a leftover must not fail the test.
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // intentionally ignored
    }
  }
}

test("createApp() without a configured databasePath opens no database file in the cwd", () => {
  const created = inEmptyCwd(() => {
    createApp();
  });

  assert.equal(created.includes("bandsearch.db"), false);
  assert.deepEqual(created, []);
});

test("createPreferenceRepository() without a configured databasePath opens no database file in the cwd", () => {
  const created = inEmptyCwd(() => {
    createPreferenceRepository();
  });

  assert.equal(created.includes("bandsearch.db"), false);
  assert.deepEqual(created, []);
});

test("an explicit databasePath is still honoured", () => {
  const created = inEmptyCwd(() => {
    createApp({ runtimeConfig: { databasePath: "explicit.db" } });
  });

  assert.ok(created.includes("explicit.db"));
});

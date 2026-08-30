import test from "node:test";
import assert from "node:assert/strict";

import {
  UPDATE_DISMISSED_VERSION_STORAGE_KEY,
  shouldShowUpdateBanner,
  getDismissedUpdateVersion,
  dismissUpdateVersion,
  type UpdateDismissalStorage,
} from "../src/updateNotification.js";

function createFakeStorage(initial: Record<string, string> = {}): UpdateDismissalStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

test("shows the banner for a newer version that was never dismissed", () => {
  assert.equal(
    shouldShowUpdateBanner({ availableVersion: "0.5.0", dismissedVersion: undefined }),
    true,
  );
});

test("stays hidden for a version the user already dismissed", () => {
  assert.equal(
    shouldShowUpdateBanner({ availableVersion: "0.5.0", dismissedVersion: "0.5.0" }),
    false,
  );
});

test("shows again for a different version after an earlier dismissal", () => {
  assert.equal(
    shouldShowUpdateBanner({ availableVersion: "0.6.0", dismissedVersion: "0.5.0" }),
    true,
  );
});

test("stays hidden when no update was reported", () => {
  assert.equal(
    shouldShowUpdateBanner({ availableVersion: undefined, dismissedVersion: undefined }),
    false,
  );
});

test("getDismissedUpdateVersion reads the dismissal key from storage", () => {
  const storage = createFakeStorage({ [UPDATE_DISMISSED_VERSION_STORAGE_KEY]: "0.5.0" });
  assert.equal(getDismissedUpdateVersion(storage), "0.5.0");
});

test("getDismissedUpdateVersion is undefined when nothing was dismissed", () => {
  const storage = createFakeStorage();
  assert.equal(getDismissedUpdateVersion(storage), undefined);
});

test("dismissUpdateVersion persists the version so it reads back", () => {
  const storage = createFakeStorage();
  dismissUpdateVersion(storage, "0.5.0");
  assert.equal(getDismissedUpdateVersion(storage), "0.5.0");
});

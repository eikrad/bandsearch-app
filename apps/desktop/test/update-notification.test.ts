import test from "node:test";
import assert from "node:assert/strict";

import {
  UPDATE_DISMISSED_VERSION_STORAGE_KEY,
  shouldShowUpdateBanner,
  getDismissedUpdateVersion,
  dismissUpdateVersion,
  createUpdateNotificationController,
  type UpdateAvailablePayload,
} from "../src/updateNotification.js";
import { fakeUpdateStorage } from "./helpers/fakeStorage.js";

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
  const storage = fakeUpdateStorage({ [UPDATE_DISMISSED_VERSION_STORAGE_KEY]: "0.5.0" });
  assert.equal(getDismissedUpdateVersion(storage), "0.5.0");
});

test("getDismissedUpdateVersion is undefined when nothing was dismissed", () => {
  assert.equal(getDismissedUpdateVersion(fakeUpdateStorage()), undefined);
});

test("dismissUpdateVersion persists the version so it reads back", () => {
  const storage = fakeUpdateStorage();
  dismissUpdateVersion(storage, "0.5.0");
  assert.equal(getDismissedUpdateVersion(storage), "0.5.0");
});

// ── controller ──────────────────────────────────────────────────────────────

const AN_UPDATE: UpdateAvailablePayload = { version: "0.5.0", canAutoInstall: true };

function controllerWithSpies(storage = fakeUpdateStorage()) {
  const shown: Array<UpdateAvailablePayload | null> = [];
  const installs: number[] = [];
  const errors: unknown[] = [];
  const controller = createUpdateNotificationController({
    storage,
    installUpdate: async () => { installs.push(1); },
    onInstallError: (e) => errors.push(e),
  });
  return { controller, shown, installs, errors, attach: () => controller.attach((p) => shown.push(p)) };
}

test("an update reported after the UI is ready shows the banner", () => {
  const c = controllerWithSpies();
  c.attach();
  c.controller.updateAvailable(AN_UPDATE);
  assert.deepEqual(c.shown, [AN_UPDATE]);
});

test("an update reported BEFORE the UI is ready is buffered, not dropped", () => {
  // The Rust check runs from .setup() and can fire before the webview has
  // finished booting. Tauri's emit has no replay, so the controller has to
  // hold the payload until attach() rather than losing it for that launch.
  const c = controllerWithSpies();
  c.controller.updateAvailable(AN_UPDATE);
  assert.deepEqual(c.shown, [], "nothing can render before attach");
  c.attach();
  assert.deepEqual(c.shown, [AN_UPDATE], "buffered update renders once attached");
});

test("a dismissed version is not buffered and never reaches the UI", () => {
  const storage = fakeUpdateStorage({ [UPDATE_DISMISSED_VERSION_STORAGE_KEY]: "0.5.0" });
  const c = controllerWithSpies(storage);
  c.controller.updateAvailable(AN_UPDATE);
  c.attach();
  assert.deepEqual(c.shown, []);
});

test("dismissing persists the version and retracts the banner", () => {
  const storage = fakeUpdateStorage();
  const c = controllerWithSpies(storage);
  c.attach();
  c.controller.updateAvailable(AN_UPDATE);
  c.controller.handlers.onDismiss();

  assert.deepEqual(c.shown, [AN_UPDATE, null], "banner retracted");
  assert.equal(getDismissedUpdateVersion(storage), "0.5.0", "dismissal persisted");
});

test("a version dismissed in an earlier run stays hidden in the next one", () => {
  const storage = fakeUpdateStorage();
  const first = controllerWithSpies(storage);
  first.attach();
  first.controller.updateAvailable(AN_UPDATE);
  first.controller.handlers.onDismiss();

  const second = controllerWithSpies(storage);
  second.attach();
  second.controller.updateAvailable(AN_UPDATE);

  assert.deepEqual(second.shown, []);
});

test("install delegates to the injected installer", async () => {
  const c = controllerWithSpies();
  c.attach();
  c.controller.updateAvailable(AN_UPDATE);
  await c.controller.handlers.onInstall();
  assert.deepEqual(c.installs, [1]);
});

test("a failing install is reported instead of rejecting into the click handler", async () => {
  const shown: Array<UpdateAvailablePayload | null> = [];
  const errors: unknown[] = [];
  const controller = createUpdateNotificationController({
    storage: fakeUpdateStorage(),
    installUpdate: async () => { throw new Error("installer exploded"); },
    onInstallError: (e) => errors.push(e),
  });
  controller.attach((p) => shown.push(p));
  controller.updateAvailable(AN_UPDATE);

  await controller.handlers.onInstall();

  assert.equal(errors.length, 1, "the failure is surfaced to the caller");
  assert.match(String(errors[0]), /installer exploded/);
});

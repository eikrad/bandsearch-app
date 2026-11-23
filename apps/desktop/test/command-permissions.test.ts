// Tauri rejects an app command that no granted permission allows (#330). These
// checks run in CI, which does not build the Rust crate, so they read what the
// build produced and committed: the app's ACL manifest in gen/schemas. The Rust
// side enforces the same at build time (build.rs) and end to end on the mock
// runtime (main.rs tests).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const tauriDir = path.resolve(path.dirname(process.argv[1]), "..", "src-tauri");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(tauriDir, relativePath), "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, what: string): string[] {
  assert.ok(
    Array.isArray(value) && value.every((item) => typeof item === "string"),
    `${what} must be an array of strings`,
  );
  return value;
}

/** The command names from the one list in src/app_commands.rs. */
function appCommands(): string[] {
  const source = read("src/app_commands.rs");
  const list = source.match(/\$then!\[([^\]]*)\]/);
  assert.ok(list, "src/app_commands.rs must call $then![...] with the command list");
  const names = list[1]
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  assert.ok(names.length > 0, "the command list must not be empty");
  return names;
}

/** App permission identifier -> the commands it allows, as the last build generated them. */
function appPermissions(): Map<string, string[]> {
  const manifests: unknown = JSON.parse(read("gen/schemas/acl-manifests.json"));
  assert.ok(isRecord(manifests), "acl-manifests.json must be an object");
  const app = manifests["__app-acl__"];
  assert.ok(isRecord(app) && isRecord(app.permissions), "acl-manifests.json must hold the app ACL");
  const permissions = new Map<string, string[]>();
  for (const [identifier, permission] of Object.entries(app.permissions)) {
    assert.ok(isRecord(permission) && isRecord(permission.commands), `${identifier} must list commands`);
    permissions.set(identifier, stringArray(permission.commands.allow, `${identifier} commands.allow`));
  }
  return permissions;
}

/** The permissions capabilities/default.json grants the main window. */
function grantedPermissions(): string[] {
  const capability: unknown = JSON.parse(read("capabilities/default.json"));
  assert.ok(isRecord(capability), "capabilities/default.json must be an object");
  assert.deepEqual(capability.windows, ["main"]);
  return stringArray(capability.permissions, "capability permissions");
}

test("lib.rs registers the app commands from the one list in app_commands.rs", () => {
  const shell = read("src/lib.rs");
  assert.match(shell, /\.invoke_handler\(app_commands!\(generate_handler\)\)/);
  assert.doesNotMatch(shell, /generate_handler!\s*\[/, "no second, hand-written command list");
});

test("every app command has a permission and the main window is granted it", () => {
  const permissions = appPermissions();
  const granted = new Set(grantedPermissions());

  const notAllowed = appCommands().filter(
    (command) =>
      ![...permissions].some(
        ([identifier, allows]) => granted.has(identifier) && allows.includes(command),
      ),
  );

  assert.deepEqual(
    notAllowed,
    [],
    "add the command to app_commands.rs and its allow-<name> permission to capabilities/default.json, " +
      "then build once (cargo check) so gen/schemas/acl-manifests.json is regenerated",
  );
});

test("the main window is granted no app permission beyond the registered commands", () => {
  const permissions = appPermissions();
  const commands = new Set(appCommands());

  const surplus = grantedPermissions()
    .filter((identifier) => !identifier.includes(":"))
    .filter((identifier) => !(permissions.get(identifier) ?? []).some((c) => commands.has(c)));

  assert.deepEqual(surplus, []);
});

test("the main window gets exactly the plugin permissions the frontend uses", () => {
  const plugin = grantedPermissions().filter((identifier) => identifier.includes(":"));

  assert.deepEqual(plugin.sort(), [
    // listen() for the update-available event, among the core defaults.
    "core:default",
    // openExternalLink's openUrl: allow-default-urls is only a URL scope, the command
    // needs allow-open-url. opener:default would add reveal-item-in-dir, unused.
    "opener:allow-default-urls",
    "opener:allow-open-url",
    // No updater:* permission: the frontend installs through the app's own
    // install_update command, and the Rust updater API is not behind the ACL.
  ]);
});

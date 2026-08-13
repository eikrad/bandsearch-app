import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = path.resolve(path.dirname(process.argv[1]), "..");

type TauriConfig = {
  bundle?: {
    externalBin?: string[];
    createUpdaterArtifacts?: boolean;
  };
  plugins?: {
    updater?: {
      pubkey?: string;
      endpoints?: string[];
    };
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertOptionalStringArray(
  value: unknown,
  propertyName: string,
): asserts value is string[] | undefined {
  assert.ok(
    value === undefined ||
      (Array.isArray(value) && value.every((item) => typeof item === "string")),
    `${propertyName} must be an array of strings when present`,
  );
}

function assertTauriConfig(value: unknown): asserts value is TauriConfig {
  assert.ok(isRecord(value), "tauri config must be an object");

  if (value.bundle !== undefined) {
    assert.ok(isRecord(value.bundle), "bundle must be an object");
    assertOptionalStringArray(value.bundle.externalBin, "bundle.externalBin");
    assert.ok(
      value.bundle.createUpdaterArtifacts === undefined ||
        typeof value.bundle.createUpdaterArtifacts === "boolean",
      "bundle.createUpdaterArtifacts must be boolean when present",
    );
  }

  if (value.plugins !== undefined) {
    assert.ok(isRecord(value.plugins), "plugins must be an object");
    if (value.plugins.updater !== undefined) {
      assert.ok(isRecord(value.plugins.updater), "plugins.updater must be an object");
      assert.ok(
        value.plugins.updater.pubkey === undefined ||
          typeof value.plugins.updater.pubkey === "string",
        "plugins.updater.pubkey must be a string when present",
      );
      assertOptionalStringArray(
        value.plugins.updater.endpoints,
        "plugins.updater.endpoints",
      );
    }
  }
}

function hostTriple(): string {
  const output = execSync("rustc -vV", { encoding: "utf8" });
  const match = output.match(/^host:\s+(\S+)/m);
  assert.ok(match, "could not determine host triple from rustc -vV");
  return match[1];
}

function readTauriConf(): TauriConfig {
  const confPath = path.join(root, "src-tauri/tauri.conf.json");
  const parsed: unknown = JSON.parse(fs.readFileSync(confPath, "utf8"));
  assertTauriConfig(parsed);
  return parsed;
}

test("tauri.conf.json externalBin entries all have a matching binary file", (t) => {
  const conf = readTauriConf();

  const bins = conf?.bundle?.externalBin ?? [];
  if (bins.length === 0) return;

  const triple = hostTriple();

  for (const bin of bins) {
    const name = path.basename(bin);
    const expected = path.join(root, "src-tauri/binaries", `${name}-${triple}`);
    if (!fs.existsSync(expected)) {
      t.skip(`binary not present — run: ln -sf $(which node) ${expected}`);
      return;
    }
  }
});

test("tauri.conf.json enables updater artifacts for signed releases", () => {
  const conf = readTauriConf();
  assert.equal(
    conf?.bundle?.createUpdaterArtifacts,
    true,
    "Expected bundle.createUpdaterArtifacts true",
  );
  assert.ok(
    conf?.plugins?.updater?.pubkey,
    "Expected plugins.updater.pubkey to be set",
  );
  assert.ok(
    Array.isArray(conf?.plugins?.updater?.endpoints) &&
      conf.plugins.updater.endpoints.some((u) =>
        String(u).includes("releases/latest/download/latest.json"),
      ),
    "Expected GitHub latest.json updater endpoint",
  );
});

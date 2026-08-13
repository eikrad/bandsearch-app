import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

type BrowserEntryProbe = {
  result: { ok: boolean };
  calls: Array<{ apiBaseUrl?: string }>;
};

const root = path.resolve(path.dirname(process.argv[1]), "..");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertBrowserEntryProbe(value: unknown): asserts value is BrowserEntryProbe {
  assert.ok(isRecord(value), "probe output must be an object");
  assert.ok(isRecord(value.result), "probe result must be an object");
  assert.equal(typeof value.result.ok, "boolean", "probe result.ok must be boolean");
  assert.ok(Array.isArray(value.calls), "probe calls must be an array");
  assert.ok(
    value.calls.every(
      (call) =>
        isRecord(call) &&
        (call.apiBaseUrl === undefined || typeof call.apiBaseUrl === "string"),
    ),
    "probe calls must contain valid options",
  );
}

test("bootBrowserDesktopApp forwards options to browser starter", () => {
  // Node 22 mock.module requires `namedExports` (not `exports`). Resolve the
  // mocked module via an absolute file URL so --eval import.meta.url is irrelevant.
  const starterHref = pathToFileURL(path.join(root, "src/startDesktopBrowserApp.js")).href;
  const entryHref = pathToFileURL(path.join(root, "src/browserEntry.js")).href;
  const probeScript = `
    import { mock } from "node:test";
    const calls = [];
    mock.module(${JSON.stringify(starterHref)}, {
      namedExports: {
        startDesktopBrowserApp: (options) => {
          calls.push(options);
          return Promise.resolve({ ok: true });
        },
      },
    });
    const { bootBrowserDesktopApp } = await import(${JSON.stringify(entryHref)});
    const result = await bootBrowserDesktopApp({ apiBaseUrl: "http://localhost:3001" });
    process.stdout.write(JSON.stringify({ result, calls }));
  `;
  const output = execFileSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      probeScript,
    ],
    { cwd: root, encoding: "utf8" },
  );
  const parsed: unknown = JSON.parse(output);
  assertBrowserEntryProbe(parsed);
  const { result, calls } = parsed;

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].apiBaseUrl, "http://localhost:3001");
});

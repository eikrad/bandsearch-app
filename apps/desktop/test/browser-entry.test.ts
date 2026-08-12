import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

type BrowserEntryProbe = {
  result: { ok: boolean };
  calls: Array<{ apiBaseUrl?: string }>;
};

test("bootBrowserDesktopApp forwards options to browser starter", () => {
  const probeScript = `
    import { mock } from "node:test";
    const calls = [];
    mock.module(new URL("./src/startDesktopBrowserApp.ts", import.meta.url), {
      exports: {
        startDesktopBrowserApp: (options) => {
          calls.push(options);
          return Promise.resolve({ ok: true });
        },
      },
    });
    const { bootBrowserDesktopApp } = await import("./src/browserEntry.ts");
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
    { cwd: process.cwd(), encoding: "utf8" },
  );
  const { result, calls } = JSON.parse(output) as BrowserEntryProbe;

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].apiBaseUrl, "http://localhost:3001");
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const renderYamlPath = resolve(__dirname, "../../../render.yaml");

test("render.yaml exists", () => {
  assert.ok(existsSync(renderYamlPath), "Expected render.yaml at repo root");
});

const renderYaml = existsSync(renderYamlPath)
  ? readFileSync(renderYamlPath, "utf8")
  : "";

test("render.yaml deploys from the main branch", () => {
  assert.ok(/branch:\s*main/.test(renderYaml), "Expected branch: main");
});

test("render.yaml healthCheckPath matches a route the API actually serves", () => {
  const match = renderYaml.match(/healthCheckPath:\s*(\S+)/);
  assert.ok(match, "Expected a healthCheckPath entry");
  const healthCheckPath = match![1];

  const routesFile = readFileSync(
    resolve(
      __dirname,
      "../../../services/api/src/routes/registerBandsearchRoutes.ts",
    ),
    "utf8",
  );
  const registeredGetRoutes = [
    ...routesFile.matchAll(/app\.get\(\s*"([^"]+)"/g),
  ].map((m) => m[1]);

  assert.ok(
    registeredGetRoutes.includes(healthCheckPath),
    `healthCheckPath ${healthCheckPath} is not among the API's registered GET routes: ${registeredGetRoutes.join(", ")}`,
  );
});

test("render.yaml uses the turso preference store in production", () => {
  assert.ok(
    /key:\s*PREFERENCE_STORE\s*\n\s*value:\s*turso/.test(renderYaml),
    "Expected PREFERENCE_STORE: turso",
  );
});

test("render.yaml declares required secrets without hardcoding values", () => {
  for (const key of [
    "GEMINI_API_KEY",
    "BRAVE_API_KEY",
    "TURSO_DATABASE_URL",
    "TURSO_AUTH_TOKEN",
    "JWT_SECRET",
  ]) {
    const re = new RegExp(`key:\\s*${key}\\s*\\n\\s*sync:\\s*false`);
    assert.ok(re.test(renderYaml), `Expected ${key} declared with sync: false`);
  }
});

test("root prepare script tolerates a missing husky binary", () => {
  // render.yaml sets NODE_ENV=production, which makes `npm install` skip
  // devDependencies (husky included) — a bare `husky` prepare script then
  // fails the whole build on Render. See github.com/typicode/husky/blob/main/docs/how-to.md
  const pkg = JSON.parse(
    readFileSync(resolve(__dirname, "../../../package.json"), "utf8"),
  );
  assert.equal(
    pkg.scripts?.prepare,
    "husky || true",
    'Expected root package.json scripts.prepare = "husky || true"',
  );
});

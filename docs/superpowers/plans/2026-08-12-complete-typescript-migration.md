# Complete TypeScript Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert every remaining project-owned `.js`/`.mjs` file to real TypeScript and enable `strict` + `noImplicitAny` across the monorepo with green CI.

**Architecture:** Application `src/` is already TypeScript. Remaining work is tooling configs, ~79 test files, and E2E helpers, then a dedicated Strict pass that also fixes existing `src/` as needed. Mechanical test ports follow the Conversion Recipe below; `require.cache` tests that cannot move to ESM cleanly get a small dependency-injection seam (allowed architecture deepening from the design).

**Tech Stack:** TypeScript 6 (`NodeNext`), `tsx --test` / `node:test`, ESLint flat config (`eslint.config.ts` via `jiti` ≥ 2.2), Playwright (`playwright.config.ts`), esbuild desktop bundle script.

**Spec:** [`docs/superpowers/specs/2026-08-12-complete-typescript-migration-design.md`](../specs/2026-08-12-complete-typescript-migration-design.md)

## Global Constraints

- Base PRs on `staging`; never merge directly to `main`.
- Real TypeScript only: ESM `import` / `import type`, no durable `any` / `as any`.
- End state: `strict: true`, `noImplicitAny: true`, no `allowJs` / `checkJs`.
- Preserve runtime behaviour unless Strict proves a bug — then fix + test and label the commit `fix:`.
- Architecture deepenings only when they unblock typing/ESM or clear a leaky seam; get a brief user go unless trivial/local; own commit; same gates.
- Domain/ADR vocabulary from `CONTEXT.md` / `docs/adr/` when proposing deepenings.
- `npm test` (or the phase’s workspace gate) green before each commit.
- NodeNext: local imports use `.js` extensions in TypeScript source (e.g. `from "../src/foo.js"`).

---

## File Map

| Path | Responsibility |
|------|----------------|
| `apps/desktop/scripts/build.ts` | Desktop esbuild + static asset copy (replaces `build.js`) |
| `eslint.config.ts` | Root flat ESLint config (replaces `eslint.config.mjs`); needs `jiti` |
| `playwright.config.ts` | Playwright root config (replaces `playwright.config.js`) |
| `tests/e2e/constants.ts` | Shared E2E port constant |
| `tests/e2e/serve-frontend.ts` | Static server for desktop `dist/` |
| `tests/e2e/recommendation.spec.ts` | Playwright UI smoke |
| `apps/desktop/test/**/*.test.ts` | Desktop unit tests (from `.js`) |
| `services/api/test/**/*.test.ts` | API unit/integration tests (from `.js`) |
| `shared/schemas/test/contracts.test.ts` | Remaining shared JS test |
| `apps/desktop/tsconfig.json` | Desktop compiler options |
| `services/api/tsconfig.json` | API compiler options (extend `include` for tests) |
| `shared/schemas/tsconfig.json` | Shared compiler options |
| Root / workspace `package.json` | Scripts, `jiti`, `allowScripts`, entrypoint paths |
| `AGENTS.md`, `docs/ROADMAP.md`, `README.md` | Policy / track / docs after cleanup |

---

## Conversion Recipe (apply to every former CJS test)

Canonical pattern already used in-repo (e.g. `apps/desktop/test/api-error-messages.test.ts`).

**Before (`*.test.js`):**

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const { createChatClient } = require("../src/chatClient");
```

**After (`*.test.ts`):**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { createChatClient } from "../src/chatClient.js";
```

**Rules for every file:**

1. `git mv path/file.test.js path/file.test.ts` (preserve history).
2. Replace all `require("…")` with `import` / `import type`.
3. Append `.js` to relative imports that resolve to TypeScript modules under `src/` or `test/` (NodeNext).
4. Type parameters, locals, and doubles; prefer types exported from `src/`; use `unknown` + narrowing for JSON.
5. Delete the old `.js` only via the rename — do not leave duplicates.
6. Run the single file (or workspace) tests before committing the batch.

**Do not** leave `// @ts-nocheck` or file-level `eslint-disable` for `no-explicit-any`.

---

## Task 1: Baseline + native install scripts

**Files:**
- Modify: `package.json` (add `allowScripts` for `better-sqlite3` and `esbuild` if missing — required for husky/`npm test` on clean checkouts)
- Verify only (no product code)

**Interfaces:**
- Consumes: none
- Produces: documented green baseline on this branch

- [ ] **Step 1: Ensure allowScripts is present**

If `package.json` lacks:

```json
"allowScripts": {
  "better-sqlite3@12.11.1": true,
  "esbuild@0.28.1": true
}
```

add it at the root object (sibling of `devDependencies`). Then:

```bash
npm install-scripts approve better-sqlite3@12.11.1
npm install-scripts approve esbuild@0.28.1
npm rebuild better-sqlite3 esbuild
node -e "require('better-sqlite3'); console.log('ok')"
```

Expected: prints `ok`.

- [ ] **Step 2: Run baseline gates**

```bash
npm run lint
npm run typecheck
npm test
```

Expected: all green (desktop may skip 1 tauri binary test — already skipped in-repo).

- [ ] **Step 3: Commit if package.json changed**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
chore: allow native install scripts for sqlite and esbuild

Unblocks husky pre-commit tests on clean checkouts for the TypeScript migration branch.
EOF
)"
```

If `package.json` was already correct, skip the commit and record baseline as done in the plan checkboxes only.

---

## Task 2: Desktop build script → TypeScript

**Files:**
- Create: `apps/desktop/scripts/build.ts` (content below)
- Delete: `apps/desktop/scripts/build.js` (via `git mv`)
- Modify: `apps/desktop/package.json` scripts `build` / `build:watch`
- Modify: `apps/desktop/test/build-script.test.js` → will be fully converted in Task 4; for this task only update the exec command if the test still runs as `.js`, **or** convert this one test file here so the gate stays green
- Modify: `apps/desktop/tsconfig.json` `include` to cover `scripts/**/*.ts`

**Interfaces:**
- Consumes: `esbuild` BuildOptions
- Produces: `scripts/build.ts` runnable via `tsx`

- [ ] **Step 1: Rename and rewrite build script**

```bash
git mv apps/desktop/scripts/build.js apps/desktop/scripts/build.ts
```

Replace file contents with:

```typescript
import * as esbuild from "esbuild";
import fs from "node:fs";
import type { BuildOptions } from "esbuild";

const config: BuildOptions = {
  entryPoints: ["./src/browserEntry.ts"],
  bundle: true,
  outfile: "dist/bundle.js",
  platform: "browser",
};

async function run(): Promise<void> {
  const watch = process.argv.includes("--watch");
  fs.mkdirSync("dist", { recursive: true });
  fs.copyFileSync("public/index.html", "dist/index.html");
  fs.copyFileSync("public/styles.css", "dist/styles.css");

  if (watch) {
    const ctx = await esbuild.context({ ...config, sourcemap: true });
    await ctx.watch();
    console.log("watching for changes…");
  } else {
    await esbuild.build({ ...config, minify: true });
    console.log("build complete");
  }
}

run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Update package scripts and tsconfig**

In `apps/desktop/package.json`:

```json
"build": "tsx scripts/build.ts",
"build:watch": "tsx scripts/build.ts --watch",
"lint": "eslint \"src/**/*.{js,ts}\" \"test/**/*.{js,ts}\" \"scripts/**/*.{js,ts}\" --max-warnings=0 --no-error-on-unmatched-pattern"
```

In `apps/desktop/tsconfig.json` `include`, ensure:

```json
"scripts/**/*.ts"
```

- [ ] **Step 3: Point build-script test at the new command**

If `apps/desktop/test/build-script.test.js` still exists, change:

```javascript
execSync("npx tsx scripts/build.ts", { cwd: root, stdio: "pipe" });
```

(Prefer converting this file to `.ts` in the same commit using the Conversion Recipe.)

- [ ] **Step 4: Gates**

```bash
npm run build --workspace @bandsearch/desktop
npm test --workspace @bandsearch/desktop -- test/build-script.test.ts
# or .js if not yet renamed
npm run typecheck --workspace @bandsearch/desktop
```

Expected: build prints `build complete`; test passes; typecheck passes.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/scripts/build.ts apps/desktop/package.json apps/desktop/tsconfig.json apps/desktop/test/build-script.test.ts
git commit -m "$(cat <<'EOF'
chore(desktop): convert build script to TypeScript

Run the esbuild bundle via tsx so desktop tooling matches the TS-only migration target.
EOF
)"
```

---

## Task 3: ESLint config → TypeScript

**Files:**
- Create: `eslint.config.ts` (from `eslint.config.mjs`)
- Delete: `eslint.config.mjs`
- Modify: root `package.json` — add `jiti` `>=2.2.0` as `devDependency`

**Interfaces:**
- Consumes: `@eslint/js`, `globals`, `typescript-eslint`
- Produces: ESLint loads `eslint.config.ts` automatically when `jiti` is installed (ESLint ≥9 flat config TS support)

- [ ] **Step 1: Install jiti**

```bash
npm install -D jiti@^2.2.0
```

- [ ] **Step 2: Rename and type the config**

```bash
git mv eslint.config.mjs eslint.config.ts
```

Keep the same runtime export; add types only where needed. Target content:

```typescript
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const typescriptConfigs = tseslint.configs.recommended.map((config) => ({
  ...config,
  files: ["**/*.ts"],
}));

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        fetch: "readonly",
      },
    },
    rules: {
      "no-console": "off",
    },
  },
  ...typescriptConfigs,
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        fetch: "readonly",
      },
    },
    rules: {
      "no-console": "off",
    },
  },
);
```

(Keep the `**/*.js` / `**/*.mjs` block until Task 11 removes all JS.)

- [ ] **Step 3: Gate**

```bash
npm run lint
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add eslint.config.ts package.json package-lock.json
git rm eslint.config.mjs
git commit -m "$(cat <<'EOF'
chore: convert eslint flat config to TypeScript

Load eslint.config.ts via jiti so root lint tooling is TypeScript-native.
EOF
)"
```

---

## Task 4: Desktop tests — batch A (no module-cache mocking)

**Files (convert each with Conversion Recipe):**
- `apps/desktop/test/app-navigation.test.js`
- `apps/desktop/test/auth-aware-fetch.test.js`
- `apps/desktop/test/browser-entry.test.js`
- `apps/desktop/test/chat-app-view.test.js`
- `apps/desktop/test/chat-client.test.js`
- `apps/desktop/test/chat-render-adapter.test.js`
- `apps/desktop/test/chat-session-app.test.js`
- `apps/desktop/test/chat-view-model.test.js`
- `apps/desktop/test/feedback-reaction-bar.test.js`
- `apps/desktop/test/hash-router.test.js`
- `apps/desktop/test/obscurity-target-picker.test.js`
- `apps/desktop/test/platform-links.test.js`
- `apps/desktop/test/tauri-config.test.js`

**Interfaces:**
- Consumes: desktop `src/**/*.ts`, helpers under `apps/desktop/test/helpers/*.ts`
- Produces: typed `.test.ts` siblings; no behaviour change

- [ ] **Step 1: Convert each file**

For each path above:

```bash
git mv apps/desktop/test/<name>.test.js apps/desktop/test/<name>.test.ts
```

Apply Conversion Recipe. Example (`platform-links` shape):

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { buildPlatformLinks } from "../src/platformLinks.js";

test("buildPlatformLinks URL-encodes artist names with special characters", () => {
  const links = buildPlatformLinks("AC/DC");
  assert.ok(links.every((link) => !link.url.includes(" ")));
});
```

Use real return types from `src/` for locals. Prefer `import type` for type-only symbols.

- [ ] **Step 2: Gate**

```bash
npm test --workspace @bandsearch/desktop
npm run typecheck --workspace @bandsearch/desktop
```

Expected: all desktop tests pass (existing skip OK); typecheck pass.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test
git commit -m "$(cat <<'EOF'
test(desktop): convert batch A unit tests to TypeScript

Port CommonJS node:test suites to ESM TypeScript with NodeNext import paths.
EOF
)"
```

---

## Task 5: Desktop tests — batch B (views / mount / settings)

**Files:**
- `apps/desktop/test/desktop-react-shell.test.js`
- `apps/desktop/test/desktop-render-adapter-bootstrap.test.js`
- `apps/desktop/test/desktop-ui-bootstrap.test.js`
- `apps/desktop/test/gemini-desktop-settings.test.js`
- `apps/desktop/test/mount-desktop-react-app.test.js`
- `apps/desktop/test/routed-mount.test.js`
- `apps/desktop/test/saved-artists-app.test.js`
- `apps/desktop/test/saved-artists-model.test.js`
- `apps/desktop/test/saved-artists-view.test.js`
- `apps/desktop/test/settings-view.test.js`

**Interfaces:**
- Consumes: `fakeDom.ts`, `fakeViewProps.ts`, `fakeApp.ts`, `fakeResponse.ts`
- Produces: typed view/mount tests

- [ ] **Step 1: Convert each file** with Conversion Recipe + `git mv`.

Helpers are already `.ts` — import them as:

```typescript
import { fakeContainer } from "./helpers/fakeDom.js";
import { jsonResponse } from "./helpers/fakeResponse.js";
```

- [ ] **Step 2: Gate**

```bash
npm test --workspace @bandsearch/desktop
npm run typecheck --workspace @bandsearch/desktop
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test
git commit -m "$(cat <<'EOF'
test(desktop): convert batch B view and mount tests to TypeScript

Align React shell, routing, and settings tests with ESM TypeScript helpers.
EOF
)"
```

---

## Task 6: Desktop `start-desktop-browser-app` — DI seam (architecture deepening)

**Why:** `apps/desktop/test/start-desktop-browser-app.test.js` mutates `require.cache`. That does not port to ESM/`tsx` cleanly. Deepen the module so tests inject bootstrapping functions instead of patching the loader.

**Files:**
- Modify: `apps/desktop/src/startDesktopBrowserApp.ts` — accept optional overrides
- Modify / rename: `apps/desktop/test/start-desktop-browser-app.test.js` → `.ts`
- Confirm call sites in `apps/desktop/src/` still work with defaults

**Interfaces:**
- Consumes: existing `startDesktopBrowserApp(options)` public options
- Produces:

```typescript
export type StartDesktopBrowserAppDeps = {
  bootstrapDesktopApp?: typeof bootstrapDesktopApp;
  bootstrapDesktopReactApp?: typeof bootstrapDesktopReactApp;
};

export async function startDesktopBrowserApp(
  options: StartDesktopBrowserAppOptions & { deps?: StartDesktopBrowserAppDeps } = {},
): Promise<void>;
```

(Exact existing option type names in the file take precedence — extend them; do not invent a parallel options bag.)

- [ ] **Step 1: Write failing test in TypeScript** that passes `deps` instead of `require.cache`

Create `apps/desktop/test/start-desktop-browser-app.test.ts` (convert file) with one test shaped like:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { startDesktopBrowserApp } from "../src/startDesktopBrowserApp.js";

test("startDesktopBrowserApp mounts bootstrapped react app", async () => {
  const calls: Array<{ type: string }> = [];
  await startDesktopBrowserApp({
    apiBaseUrl: "http://localhost:3333",
    viewport: "mobile",
    actionHandlers: { onSave: () => {} },
    deps: {
      bootstrapDesktopApp: (options) => {
        calls.push({ type: "bootstrapApp" });
        assert.equal(options.apiBaseUrl, "http://localhost:3333");
        return { mocked: true } as never;
      },
      bootstrapDesktopReactApp: () => {
        calls.push({ type: "bootstrapReact" });
        return {
          mount: async () => {
            calls.push({ type: "mount" });
          },
        } as never;
      },
    },
  });
  assert.deepEqual(
    calls.map((c) => c.type),
    ["bootstrapApp", "bootstrapReact", "mount"],
  );
});
```

Port the other two cases the same way (remote endpoint + matchMedia). Replace `as never` with the real return types from `src/` once identified.

- [ ] **Step 2: Run test — expect fail** (deps ignored / not in type)

```bash
npm test --workspace @bandsearch/desktop -- test/start-desktop-browser-app.test.ts
```

- [ ] **Step 3: Implement `deps` overrides** in `startDesktopBrowserApp.ts` — default to current imports when `deps` omitted. No behaviour change for production callers.

- [ ] **Step 4: Gate**

```bash
npm test --workspace @bandsearch/desktop
npm run typecheck --workspace @bandsearch/desktop
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/startDesktopBrowserApp.ts apps/desktop/test/start-desktop-browser-app.test.ts
git commit -m "$(cat <<'EOF'
refactor(desktop): inject bootstrap deps for ESM-friendly tests

Replace require.cache mutation with an optional deps seam so startDesktopBrowserApp tests run under TypeScript/tsx.
EOF
)"
```

- [ ] **Step 6: Confirm no desktop `.js` tests remain**

```bash
find apps/desktop/test -name '*.js'
```

Expected: empty.

---

## Task 7: API tests — core routes & auth

**Files:**
- All of:
  - `services/api/test/artist-image-route.test.js`
  - `services/api/test/artist-search-route.test.js`
  - `services/api/test/auth-routes.test.js`
  - `services/api/test/auth-service.test.js`
  - `services/api/test/band-group-inference.test.js`
  - `services/api/test/chat-sessions-route.test.js`
  - `services/api/test/e2e-smoke.test.js`
  - `services/api/test/env-config.test.js`
  - `services/api/test/groups-route.test.js`
  - `services/api/test/http-client.test.js`
  - `services/api/test/model-utils.test.js`
  - `services/api/test/musicbrainz-client.test.js`
  - `services/api/test/prompt-guards.test.js`
  - `services/api/test/recommendation-service.test.js`
  - `services/api/test/recommendations-route.test.js`
  - `services/api/test/system-routes.test.js`

**Also modify:** `services/api/tsconfig.json` — add test includes:

```json
"include": ["src/**/*.ts", "scripts/**/*.ts", "test/**/*.ts"]
```

**Interfaces:**
- Consumes: API `src/**/*.ts`
- Produces: typed API tests under `test/`

- [ ] **Step 1: Convert each file** (`git mv` + Conversion Recipe). Import example:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuthService } from "../src/auth/authService.js";
import { createInMemoryUserRepository } from "../src/auth/userRepository.js";
```

- [ ] **Step 2: Gate**

```bash
npm test --workspace @bandsearch/api
npm run typecheck --workspace @bandsearch/api
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add services/api/test services/api/tsconfig.json
git commit -m "$(cat <<'EOF'
test(api): convert core route and auth tests to TypeScript

Port CommonJS API suites to ESM TypeScript and include tests in the API tsconfig.
EOF
)"
```

---

## Task 8: API tests — preferences, users, Turso, research, eval

**Files:**
- Preferences / users / turso:
  - `services/api/test/postgres-preference-repository.test.js`
  - `services/api/test/preference-repository-interfaces.test.js`
  - `services/api/test/preference-repository.test.js`
  - `services/api/test/preferences-route.test.js`
  - `services/api/test/sqlite-preference-repository.test.js`
  - `services/api/test/turso-full-schema.test.js`
  - `services/api/test/turso-preference-repository.test.js`
  - `services/api/test/turso-probe-route.test.js`
  - `services/api/test/turso-user-repository.test.js`
  - `services/api/test/user-model.test.js`
  - `services/api/test/user-repository-fallback.test.js`
  - `services/api/test/user-repository.test.js`
  - `services/api/test/user-scoping.test.js`
- Research (`services/api/test/research/*.js` except already-`.ts`)
- Eval (`services/api/test/eval/*.js` except already-`.ts`)

**Interfaces:**
- Consumes: preference / user / research / eval modules
- Produces: fully TypeScript `services/api/test/**`

- [ ] **Step 1: Convert all listed files** with Conversion Recipe. Mirror typing style of `services/api/test/turso-chat-session-repository.test.ts` and `services/api/test/research/lastfm-enrichment.test.ts`.

- [ ] **Step 2: Gate**

```bash
npm test --workspace @bandsearch/api
npm run typecheck --workspace @bandsearch/api
find services/api/test -name '*.js'
```

Expected: tests + typecheck green; find empty.

- [ ] **Step 3: Commit**

```bash
git add services/api/test
git commit -m "$(cat <<'EOF'
test(api): convert preference, research, and eval tests to TypeScript

Finish the API test tree migration to ESM TypeScript.
EOF
)"
```

---

## Task 9: Shared schemas test + Playwright / E2E → TypeScript

**Files:**
- `shared/schemas/test/contracts.test.js` → `.ts`
- `playwright.config.js` → `playwright.config.ts`
- `tests/e2e/constants.js` → `.ts`
- `tests/e2e/serve-frontend.js` → `.ts`
- `tests/e2e/recommendation.spec.js` → `.ts`
- Modify root `package.json` if `test:e2e` needs adjustment (usually unchanged)

**Interfaces:**
- `constants.ts` exports `E2E_FRONTEND_PORT`
- `playwright.config.ts` imports that constant and `defineConfig` from `@playwright/test`
- `serve-frontend.ts` listens on `E2E_FRONTEND_PORT`

- [ ] **Step 1: Convert shared contracts test**

```bash
git mv shared/schemas/test/contracts.test.js shared/schemas/test/contracts.test.ts
```

Apply Conversion Recipe. Gate:

```bash
npm test --workspace @bandsearch/schemas
npm run typecheck --workspace @bandsearch/schemas
```

- [ ] **Step 2: Convert E2E constants**

```typescript
/** Shared E2E static server port — keep in sync across Playwright and the local file server. */
export const E2E_FRONTEND_PORT = 4000;
```

- [ ] **Step 3: Convert `serve-frontend.ts`**

```typescript
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { E2E_FRONTEND_PORT } from "./constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../../apps/desktop/dist");
const PORT = E2E_FRONTEND_PORT;

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
};

http
  .createServer((req, res) => {
    const file = req.url === "/" ? "index.html" : (req.url ?? "/").slice(1);
    const filePath = path.join(DIST, file);
    const ext = path.extname(filePath);
    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  })
  .listen(PORT, () => console.log(`frontend on http://localhost:${PORT}`));
```

- [ ] **Step 4: Convert Playwright config**

```typescript
import { defineConfig } from "@playwright/test";
import { E2E_FRONTEND_PORT } from "./tests/e2e/constants.js";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 40000,
  use: {
    baseURL: `http://localhost:${E2E_FRONTEND_PORT}`,
    headless: true,
  },
  webServer: [
    {
      command: "node --import tsx services/api/src/server.ts",
      port: 3001,
      reuseExistingServer: false,
      timeout: 15000,
      env: { PORT: "3001" },
    },
    {
      command: "npx tsx tests/e2e/serve-frontend.ts",
      port: E2E_FRONTEND_PORT,
      reuseExistingServer: false,
      timeout: 5000,
    },
  ],
});
```

- [ ] **Step 5: Convert `recommendation.spec.ts`**

```typescript
import { test, expect } from "@playwright/test";

test.describe("Bandsearch UI", () => {
  test("renders the app with mode toggle and input", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("Bandsearch");
    await expect(page.locator("input[name=query]")).toBeVisible();
    await expect(page.locator("button[type=submit]")).toContainText("Recommend");
    await expect(page.locator(".mode-pill")).toBeVisible();
    await expect(page.locator(".mode-pill button").first()).toBeVisible();
  });
  // …port remaining tests verbatim with import syntax only…
});
```

- [ ] **Step 6: Gates**

```bash
npx playwright test --list
npm test --workspace @bandsearch/schemas
```

Expected: Playwright lists the Bandsearch UI tests; schemas tests green.

- [ ] **Step 7: Commit**

```bash
git add shared/schemas/test playwright.config.ts tests/e2e
git rm -f playwright.config.js tests/e2e/*.js shared/schemas/test/contracts.test.js
git commit -m "$(cat <<'EOF'
test(e2e): convert Playwright config and E2E helpers to TypeScript

Also finish the shared contracts test migration.
EOF
)"
```

---

## Task 10: Enable Strict across the monorepo

**Files:**
- Modify: `apps/desktop/tsconfig.json`
- Modify: `services/api/tsconfig.json`
- Modify: `shared/schemas/tsconfig.json`
- Modify: any `src/**/*.ts` / `test/**/*.ts` that fail under Strict

**Target compiler options (each package):**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noImplicitAny": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true
  }
}
```

Remove `allowJs`, `checkJs`, and any `"strict": false` / `"noImplicitAny": false`. Keep package-specific `lib` (desktop keeps `DOM`).

**Interfaces:**
- Consumes: fully TypeScript tree from prior tasks
- Produces: Strict-clean typecheck

- [ ] **Step 1: Flip flags in all three tsconfigs**

- [ ] **Step 2: Run typecheck and collect errors**

```bash
npm run typecheck 2>&1 | tee /tmp/ts-strict.out
```

- [ ] **Step 3: Fix errors without behaviour changes**

Priority order:
1. Add missing parameter / return types
2. Narrow `unknown` at JSON/http boundaries (reuse Zod schemas where they exist)
3. Optional properties / definite assignment
4. If a real bug appears: fix + add/adjust test; commit message starts with `fix:`

If a fix requires a non-trivial module deepening, pause and propose it to the user (design rule).

- [ ] **Step 4: Gates**

```bash
npm run typecheck
npm test
```

Expected: both green.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/tsconfig.json services/api/tsconfig.json shared/schemas/tsconfig.json
git add -u
git commit -m "$(cat <<'EOF'
chore: enable TypeScript strict mode across workspaces

Turn on strict and noImplicitAny, drop allowJs/checkJs, and fix resulting type errors without changing runtime behaviour.
EOF
)"
```

(Split into `fix:` commits first if bug fixes were required.)

---

## Task 11: Cleanup — scripts, lint JS block, docs, inventory

**Files:**
- Modify: root `package.json` — `start` / `dev` must use `services/api/src/server.ts` (not `.js`)
- Modify: `eslint.config.ts` — remove the `**/*.js` / `**/*.mjs` block
- Modify: workspace lint globs that still mention `*.js` if no JS remains
- Modify: `AGENTS.md` — replace incremental migration policy with “TypeScript is the only language for app/test/config JS-toolchain code; Strict is required”
- Modify: `docs/ROADMAP.md` — mark Parallel Track TypeScript migration `✓ Done` (full completion, not incremental)
- Modify: `README.md` if it still describes mixed JS/TS
- Verify inventory

- [ ] **Step 1: Fix root scripts**

```json
"start": "tsx services/api/src/server.ts",
"dev": "tsx services/api/src/server.ts"
```

- [ ] **Step 2: Remove JS ESLint block** from `eslint.config.ts` (only `**/*.ts` configs remain).

- [ ] **Step 3: Update docs** as above (exact AGENTS replacement text):

```markdown
### TypeScript

Application, test, and JS-toolchain config code is TypeScript only (`strict` + `noImplicitAny`). Do not add new `.js` / `.mjs` sources.
```

- [ ] **Step 4: Inventory gate**

```bash
find . -type f \( -name '*.js' -o -name '*.mjs' \) \
  ! -path './node_modules/*' ! -path './.git/*' ! -path '*/dist/*' ! -path '*/target/*'
```

Expected: empty (or only generated artefacts if any — none expected).

- [ ] **Step 5: Full CI gate**

```bash
npm run ci
```

Expected: green. Optional: `npm run build --workspace @bandsearch/desktop` and `npm run dev` smoke.

- [ ] **Step 6: Commit**

```bash
git add package.json eslint.config.ts AGENTS.md docs/ROADMAP.md README.md
git commit -m "$(cat <<'EOF'
docs: retire incremental JS migration policy after Strict TypeScript completion

Point root scripts at server.ts, drop JS eslint overrides, and mark the roadmap track done.
EOF
)"
```

---

## Plan Self-Review

| Spec requirement | Task |
|------------------|------|
| All remaining JS/MJS → TS (incl. eslint) | 2–9, 11 |
| Real types, no durable `any` | Conversion Recipe + 10 |
| `strict` + `noImplicitAny`; drop `allowJs`/`checkJs` | 10 |
| Phased verification gates | Steps labeled Gate in each task |
| Architecture deepenings when friction | Task 6 (`deps` seam) |
| Docs / AGENTS / Roadmap / stale `server.js` | 11 |
| PRs to `staging` | Global Constraints |

No TBD/placeholder steps remain. Import extension rule and ESLint `jiti` approach match current toolchain docs.

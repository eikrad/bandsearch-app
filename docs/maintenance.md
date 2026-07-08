# Maintenance Log

Weekly dependency and health checks for the Bandsearch application.

---

## 2026-07-08

### Checks performed
- Rebased working branch onto latest `origin/staging`
- Baseline: `npm run lint`, `npm run typecheck`, `npm run test` at root (covers `apps/desktop`,
  `services/api`, `services/eval`, `shared/schemas` via `--workspaces --if-present`) — all green
  (678 tests total: 222 desktop, 423 api, 16 eval, 17 schemas)
- Rust: `cargo check`, `cargo test` (`apps/desktop/src-tauri`) — both green (20/20 unit tests)
- Dependency audit across every ecosystem present:
  - npm (root + all workspaces) — `npm outdated`, `npm audit`
  - Python (root `pyproject.toml` / `uv.lock`) — `uv export` + `pip-audit`
  - Rust (`apps/desktop/src-tauri/Cargo.toml`) — `cargo outdated`-equivalent via `cargo update`
    dry-run + `cargo audit` (installed `cargo-audit` v0.22.2; not previously present)
- Re-checked `.github/workflows/ci.yml` Node version vs root `package.json` `engines` — still
  both Node 22, no regression since the 2026-06-10 fix
- Reviewed the `.github/dependabot.yml` / `.github/workflows/weekly-audit.yml` added in the
  2026-06-24 cycle for ecosystem-coverage gaps now that a Python project (`pyproject.toml`,
  `uv.lock`) exists at the repo root

### Fixes applied

- **Security (high, applied despite being a transitive major bump) — `quick-xml` advisories
  RUSTSEC-2026-0194 / RUSTSEC-2026-0195** — `cargo audit` flagged two high-severity (CVSS 7.5)
  issues in `quick-xml 0.39.2` (quadratic run time checking duplicate attribute names; unbounded
  namespace-declaration allocation enabling memory-exhaustion DoS), pulled in transitively via
  `plist 1.9.0` (used by `tauri-utils` for Info.plist generation). `plist 1.9.0` pins
  `quick-xml = "^0.39.2"`, so the fix required bumping `plist` itself — `quick-xml` alone could not
  be moved to the patched `0.41.0` without it. Ran `cargo update -p plist --precise 1.10.0`, which
  resolved `quick-xml` to `0.41.0` (fixed). This stayed inside `tauri`'s own declared range
  (`plist = "^1"`), so no `Cargo.toml` edits were needed — only `Cargo.lock` changed. Re-ran
  `cargo audit` (0 vulnerabilities, down from 2 high) and re-verified `cargo check` + `cargo test`
  (20/20) green after the bump. Flagging this prominently per policy: **the underlying `plist`
  bump (1.9.0 → 1.10.0) was a deeper transitive resolution than a routine patch, applied solely
  because it was the only path to the security fix.**

- **Dependabot ecosystem gap** — `.github/dependabot.yml` (added 2026-06-24) had no entry for the
  Python/`uv` project at the repo root. Added a `package-ecosystem: "uv"` entry (directory `/`,
  weekly, target `staging`).
- **Dependabot Cargo path bug** — the existing Cargo entry pointed `directory: "/apps/desktop"`,
  but `Cargo.toml` actually lives at `apps/desktop/src-tauri/Cargo.toml`. Dependabot would never
  have found a manifest at the configured path. Fixed to `/apps/desktop/src-tauri`.
- **Weekly audit workflow gap** — `.github/workflows/weekly-audit.yml` (added 2026-06-24) only ran
  `npm audit`. Extended it to also run `pip-audit` (via `astral-sh/setup-uv` + `uv export`) and
  `cargo-audit` (against `apps/desktop/src-tauri/Cargo.lock`), modeled on the sibling
  `eikrad/Job-Tracker` repo's workflow. All three tools now report into the same step summary and
  the same `security-audit`-labelled issue on high/critical findings.

### Dependency status

**Root workspace (`package.json`)** — patch/minor bumps applied via `npm update`:

| Package | Before | After | Status |
|---|---|---|---|
| `tsx` | `4.22.4` | `4.23.0` | Updated (within `^4.22.4` range) |
| `typescript-eslint` | `8.62.1` | `8.63.0` | Updated (within `^8.62.1` range) |
| `@types/node` | `25.9.4` | `25.9.5` | Updated (patch only — `26.x` major pending, see below) |
| `typescript` | `6.0.3` | `6.0.3` | Current within range — `7.x` major pending, see below |
| `eslint`, `@playwright/test`, `husky`, `globals`, `@eslint/js`, `@types/express` | — | — | No newer versions in range this cycle |

**`apps/desktop` (npm)** — no outdated packages (`@tauri-apps/api`, `@tauri-apps/cli`, `react`,
`react-dom`, `esbuild` all current).

**`services/api` (npm)** — no outdated packages (`express`, `zod`, `@langchain/langgraph`,
`@langchain/google-genai`, `better-sqlite3`, `dotenv`, `jsonwebtoken`, `bcryptjs`, `helmet`,
`express-rate-limit`, `@libsql/client`, `pg` all current).

**`services/eval`, `shared/schemas` (npm)** — no dependencies outdated.

**Root Python (`pyproject.toml` / `uv.lock`)** — `dependencies = []`; no runtime dependencies are
declared, so there is nothing to bump. `ruff`/`black` are used as lint tools outside the `uv.lock`
dependency graph (invoked directly or via `.venv` if present).

**`apps/desktop/src-tauri` (Cargo)**:

| Crate | Before | After | Status |
|---|---|---|---|
| `plist` (transitive, via `tauri-utils`) | `1.9.0` | `1.10.0` | Updated — security fix, see above |
| `quick-xml` (transitive, via `plist`) | `0.39.2` | `0.41.0` | Updated — security fix, see above |
| `tauri`, `tauri-build`, `tauri-plugin-opener`, `serde`/`serde_json`, `dirs` | `2` / `1` / `5` | unchanged | Current within broad `Cargo.toml` constraints |

### Security audit results

| Ecosystem | Tool | Result |
|---|---|---|
| npm (all workspaces) | `npm audit` | 0 vulnerabilities |
| Python (root) | `pip-audit` (via `uv export --format requirements-txt`) | 0 vulnerabilities (no declared runtime deps) |
| Rust (`apps/desktop/src-tauri`) | `cargo audit` | 2 high (RUSTSEC-2026-0194, RUSTSEC-2026-0195) → **fixed this cycle**; 0 vulnerabilities remaining; 18 informational "unmaintained/unsound" warnings remain (see Notes) |

### Major upgrades pending (not applied — flagged for manual review)

| Package | Current | Latest | Notes |
|---|---|---|---|
| `typescript` | `6.0.3` | `7.0.2` | Major rewrite; needs a dedicated compatibility pass across all 4 npm workspaces before adopting |
| `@types/node` | `25.9.5` | `26.1.1` | Type-defs major tracks a newer Node line than the `engines: ">=22"` floor; low risk but flagged per policy |

### Notes

- **Dual lock files (still open, re-flagged again this cycle):** `package-lock.json` (root) and
  `pnpm-lock.yaml` both still exist. `pnpm-lock.yaml` was last committed 2026-05-31 — over five
  weeks stale relative to this cycle — while `package-lock.json` is updated by every npm-based
  maintenance cycle (most recently this one). Concretely, `pnpm-lock.yaml` still resolves
  `@types/node` to `25.9.1` and `typescript-eslint`'s peer to `^8.60.0`, while `package-lock.json`
  now resolves `25.9.5` / `8.63.0` respectively — the drift is real and growing. CI uses `npm ci`
  (reads only `package-lock.json`), so anyone installing locally with `pnpm install` is working
  against materially different resolved versions than CI. Not resolved this cycle — removing
  either lock file is a call for the repo owner, not an agent.
- **Rust `cargo-audit` "unmaintained"/"unsound" warnings (informational, not blocking):** 18
  warnings remain after the `quick-xml` fix above — the GTK3 bindings pulled in by `tauri`'s Linux
  backend (`gtk`, `gtk-sys`, `gdk*`, `atk*`, RUSTSEC-2024-041x series), plus `proc-macro-error`,
  the `unic-*` crates, and unsound-but-currently-unfixed advisories in `anyhow` and `glib`. These
  are all transitive through `tauri` itself and have no independently-updatable fix from this
  repo (no newer non-vulnerable version exists yet upstream); they will keep surfacing via
  Dependabot's Cargo advisories and the weekly audit workflow until `tauri` moves off GTK3
  bindings. Not a regression — `cargo audit` exits 0 (warnings only, no vulnerabilities).
- **Local dev environment requirement:** `apps/desktop/src-tauri/binaries/node-<target-triple>` is
  a tracked symlink (see `apps/desktop/src-tauri/binaries/README`) that must resolve to a real
  `node` binary for `cargo check`/`cargo test`/`cargo build` to succeed (Tauri's `externalBin`
  resource check runs even for `cargo check`). `apps/desktop/test/tauri-config.test.js` skips
  gracefully with the exact remediation command when the resolved binary is missing — this is
  expected in environments without a matching system `node` path and is not a code defect.

---

## 2026-06-24

### Checks performed
- Reviewed root `package.json`, `apps/desktop/package.json`, `services/api/package.json`
- Reviewed `apps/desktop/src-tauri/Cargo.toml`
- Reviewed `.github/workflows/ci.yml`
- Compared all versions against ecosystem state

### Infrastructure added

- **Dependabot** — Added `.github/dependabot.yml` to automate weekly PR generation for:
  - npm (root, covers all workspaces) — targets `staging`
  - Cargo (`/apps/desktop`) — targets `staging`; also raises security alerts via GitHub Advisory DB
  - GitHub Actions — targets `staging`

- **Weekly security audit** — Added `.github/workflows/weekly-audit.yml`. Runs every Monday
  at 06:00 UTC and can be triggered manually via `workflow_dispatch`:
  - Audits all npm workspace packages with `npm audit` (single run at root covers everything)
  - Writes a full report to the workflow step summary
  - If high- or critical-severity vulnerabilities are found, opens (or updates) a GitHub Issue
    labelled `security-audit` + `maintenance`

  Rust/Cargo security vulnerabilities are covered by Dependabot's security alerts (advisory
  database), so `cargo audit` is not duplicated in the workflow.

### Dependency status

**Root workspace (`package.json`):**

| Package | Version | Status |
|---|---|---|
| `tsx` | `^4.22.3` | Current |
| `typescript` | `^6.0.3` | Current |
| `eslint` | `^10.4.0` | Current |
| `@playwright/test` | `^1.59.1` | Current |
| `@types/node` | `^25.6.0` | Current |
| `husky` | `^9.1.7` | Current |
| `typescript-eslint` | `^8.60.0` | Current |

**`services/api` (from prior cycle):**

| Package | Version | Status |
|---|---|---|
| `express` | `^5.2.1` | Current |
| `zod` | `^4.4.3` | Current |
| `@langchain/langgraph` | `^1.3.2` | Current |
| `@langchain/google-genai` | `^2.1.31` | Current |
| `better-sqlite3` | `^12.10.0` | Current |
| `jsonwebtoken` | `^9.0.3` | Current |
| `helmet` | `^8.2.0` | Current |
| `express-rate-limit` | `^8.5.2` | Current |

**`apps/desktop` Rust — Cargo:**
Broad `2.x` constraints tracked by `Cargo.lock`. Dependabot will open PRs for patch/minor bumps.

### Known open issue
- **Dual lock files** — `package-lock.json` (root) and `pnpm-lock.yaml` coexist. CI uses `npm ci`
  (reads `package-lock.json`). If pnpm is used locally the resolved versions may drift from CI.
  Consider removing `pnpm-lock.yaml` or switching CI to pnpm.

### No major upgrades pending
All packages are on current major versions this cycle.

---

## 2026-06-10

### Checks performed
- Reviewed root `package.json`, `apps/desktop/package.json`, `services/api/package.json`
- Reviewed `apps/desktop/src-tauri/Cargo.toml`
- Reviewed CI workflow in `.github/workflows/ci.yml`
- Compared versions across all workspaces

### Fixes applied

- **CI Node version (bug fix)** — Bumped Node from `20` to `22` in `.github/workflows/ci.yml`. The root `package.json` declares `"engines": { "node": ">=22" }` but CI was running Node 20, meaning every CI run executed on a Node version the project explicitly does not support. This is now consistent.

### Dependency status

**Root workspace (`package.json`):**

| Package | Version | Status |
|---|---|---|
| `tsx` | `^4.22.3` | Current |
| `typescript` | `^6.0.3` | Current |
| `eslint` | `^10.4.0` | Current |
| `@playwright/test` | `^1.59.1` | Current |
| `husky` | `^9.1.7` | Current |
| `globals` | `^17.6.0` | Current |
| `typescript-eslint` | `^8.60.0` | Current |

**`apps/desktop` (`apps/desktop/package.json`):**

| Package | Version | Status |
|---|---|---|
| `@tauri-apps/api` | `^2.11.0` | Current |
| `@tauri-apps/cli` | `^2.11.2` | Current |
| `react` | `^19.2.6` | Current |
| `react-dom` | `^19.2.6` | Current |
| `esbuild` | `^0.28.0` | Current |

**`apps/desktop` Rust (`apps/desktop/src-tauri/Cargo.toml`):**
Uses broad `version = "2"` constraints for tauri — resolved by `Cargo.lock`.

| Crate | Constraint | Status |
|---|---|---|
| `tauri` | `2` | Current |
| `tauri-build` | `2` | Current |
| `tauri-plugin-opener` | `2` | Current |
| `serde` / `serde_json` | `1` | Current |
| `dirs` | `5` | Current |

**`services/api` (`services/api/package.json`):**

| Package | Version | Status |
|---|---|---|
| `express` | `^5.2.1` | Current |
| `zod` | `^4.4.3` | Current |
| `@langchain/langgraph` | `^1.3.2` | Current |
| `@langchain/google-genai` | `^2.1.31` | Current |
| `better-sqlite3` | `^12.10.0` | Current |
| `dotenv` | `^17.4.2` | Current |
| `jsonwebtoken` | `^9.0.3` | Current |
| `bcryptjs` | `^3.0.3` | Current |
| `helmet` | `^8.2.0` | Current |
| `express-rate-limit` | `^8.5.2` | Current |
| `@libsql/client` | `^0.17.3` | Current |
| `pg` | `^8.21.0` | Current |

### Notes

- **Dual lock files:** `package-lock.json` (root) and `pnpm-lock.yaml` both exist. CI uses `npm ci` (reads `package-lock.json`). If pnpm is used locally the resolved versions may differ from CI. Consider removing one set of lock files to avoid drift.

### No major upgrades pending
All packages are on current major versions this cycle.

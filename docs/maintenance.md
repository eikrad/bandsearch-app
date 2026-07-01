# Maintenance Log

Weekly dependency and health checks for the Bandsearch application.

---

## 2026-07-01

### Checks performed
- Reviewed root `package.json`, `apps/desktop/package.json`, `services/api/package.json`
- Ran `npm outdated` / `npm audit` in root, `apps/desktop`, and `services/api`
- Reviewed `apps/desktop/src-tauri/Cargo.toml` and `Cargo.lock` for outdated/vulnerable crates; `cargo audit` could not reach the RustSec advisory database from this sandbox (proxy returned 403 on the git fetch) and `cargo check`/`cargo test` could not run because `libwebkit2gtk-4.1-dev`/`libgtk-3-dev` are not installed and the Ubuntu security mirror 404'd on those packages when installation was attempted — reasoned manually instead (see Rust section below)
- Reviewed `pyproject.toml` / `uv.lock`; ran `uv sync` (resolves 1 package — the project itself, zero runtime dependencies) and `pip-audit`, which confirmed there is nothing to audit for this project (the sandbox's system Python packages are not part of the dependency tree)
- Reviewed `.github/workflows/ci.yml` and `protect-main.yml` — both correct, no changes needed
- Checked CI status on `staging` via GitHub Actions — last 6 runs all green (most recent: run 27791377341, success)
- Checked for an existing PR on `claude/eloquent-volta-6z1i7i` — none found, worked on the branch as-is

### Fixes applied

- **esbuild security fix (low severity)** — Bumped `esbuild` in `apps/desktop/package.json` from `^0.28.0` to `^0.28.1`, resolving [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) (arbitrary file read via the esbuild dev server on Windows). `npm audit` now reports 0 vulnerabilities in all workspaces.
- **Patch/minor bumps applied** (all non-breaking, within existing semver ranges or bumped to the latest compatible range):

**Root workspace (`package.json`):**

| Package | Old | New |
|---|---|---|
| `tsx` | `^4.22.3` | `^4.22.4` |
| `@playwright/test` | `^1.59.1` | `^1.61.1` |
| `eslint` | `^10.4.0` | `^10.6.0` |
| `globals` | `^17.6.0` | `^17.7.0` |
| `typescript-eslint` | `^8.60.0` | `^8.62.1` |
| `@types/node` | `^25.6.0` | `^25.9.4` |

**`apps/desktop` (`apps/desktop/package.json`):**

| Package | Old | New |
|---|---|---|
| `@tauri-apps/api` | `^2.11.0` | `^2.11.1` |
| `@tauri-apps/cli` | `^2.11.2` | `^2.11.4` |
| `react` | `^19.2.6` | `^19.2.7` |
| `react-dom` | `^19.2.6` | `^19.2.7` |
| `esbuild` | `^0.28.0` | `^0.28.1` (security fix, see above) |

**`services/api` (`services/api/package.json`):**

| Package | Old | New |
|---|---|---|
| `@libsql/client` | `^0.17.3` | `^0.17.4` |
| `better-sqlite3` | `^12.10.0` | `^12.11.1` |
| `pg` | `^8.21.0` | `^8.22.0` |
| `@langchain/langgraph` (lockfile only, range unchanged `^1.3.2`) | `1.4.1` installed | `1.4.7` installed |
| `@langchain/google-genai` (lockfile only, range unchanged `^2.1.31`) | installed at range floor | `2.2.0` installed |

All three `package-lock.json` / workspace lockfiles refreshed accordingly.

### Rust (`apps/desktop/src-tauri`)

Cargo.toml still uses broad `version = "2"` constraints for tauri, resolved by `Cargo.lock`. Inspected `Cargo.lock` directly since `cargo audit`/`cargo outdated`/`cargo check` could not run in this sandbox (see Checks performed):

| Crate | Locked version | Status |
|---|---|---|
| `tauri` | `2.11.0` | Current, no known advisories |
| `tauri-build` | `2.6.0` | Current |
| `tauri-plugin-opener` | `2.5.4` | Current |
| `wry` | `0.55.0` | Current |
| `reqwest` | `0.13.3` | Current |
| `idna` | `1.1.0` | Patched — fixes RUSTSEC-2024-0421 (unequal-hostname bug fixed in idna >=1.0.3) |
| `url` | `2.5.8` | Current |
| `time` | `0.3.47` | Current |
| `chrono` | `0.4.44` | Current |
| `flate2` | `1.1.9` | Current |
| `serde` / `serde_json` | `1.0.228` / `1.0.149` | Current |
| `dirs` | `5.0.1`, `6.0.0` (mixed, transitive) | No action — both current majors, no advisories |

No RUSTSEC advisories found against any pinned version via manual review + web search. No Cargo.lock changes required this cycle.

### Notes

- **Dual lock files — still present, not resolved.** `package-lock.json` (root) and `pnpm-lock.yaml` both still exist, and `pnpm-lock.yaml` is now further out of date after this cycle's `npm install`-driven updates (CI only runs `npm ci` against `package-lock.json`, so this doesn't affect CI correctness). Left `pnpm-lock.yaml` untouched rather than regenerating it: doing so would require installing/trusting pnpm in this environment purely to update a lockfile nothing in CI reads, which carries more risk (potential divergent resolution, extra unreviewed diff) than benefit. Recommend a follow-up decision (outside this routine sweep) to either delete `pnpm-lock.yaml` and standardize on npm, or migrate CI to pnpm and drop `package-lock.json` — the drift will keep growing every week otherwise.
- `cargo audit` and Tauri `cargo check`/`cargo test` remain unrunnable in this sandbox (network policy blocks the RustSec advisory-db git fetch; Ubuntu security mirror 404s on `libwebkit2gtk-4.1-dev` and related GTK packages needed to compile the Tauri crate). This has been true across at least the last two maintenance cycles — flagging in case a future sweep runs in an environment with broader network/package access and can get a real `cargo audit`/`cargo check` pass.

### Major upgrades pending (not applied)

- **`@types/node`**: `^25.9.4` → `26.1.0` available. This is a major version bump; `@types/node` majors track Node.js majors and the project currently targets Node 22 (`engines.node: ">=22"`), so jumping to `@types/node@26` should be evaluated alongside an actual Node runtime upgrade decision, not applied silently as a typings-only bump.

All other packages across every workspace are on their current major version this cycle.

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

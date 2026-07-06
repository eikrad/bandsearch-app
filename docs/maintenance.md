# Maintenance Log

Weekly dependency and health checks for the Bandsearch application.

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

# Maintenance Log

Weekly dependency and health checks for the Bandsearch application.

---

## 2026-07-15

### Checks performed
- Reset working branch to `staging`'s current tip (`617d586`) before starting — branch had been
  seeded from `main` instead.
- Baseline: `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` (desktop)
  — all green before any changes.
- `npm outdated` / `npm audit` across all workspaces (root, `apps/desktop`, `services/api`,
  `services/eval`, `shared/schemas`).
- Reviewed `apps/desktop/src-tauri/Cargo.toml` / `Cargo.lock` for outstanding Rust advisories.
- Checked recent CI runs on `staging` via GitHub Actions API.
- Confirmed root `pyproject.toml` still declares `dependencies = []` — no Python runtime deps,
  `pip-audit` skipped as not applicable.
- Re-ran the full baseline suite after applying updates.

### CI health (staging)
Most recent runs on `staging` (`CI` and `Protect main`) both `completed` / `success`
(e.g. run `27791377341`, 2026-06-18). No red runs found in the last 5 on the branch.

### Fixes applied

- **Security fix (re-applied) — RUSTSEC-2026-0194 / RUSTSEC-2026-0195 (quick-xml, via `plist` →
  `tauri-utils`).** Staging's current tip does **not** include the fix from the still-unmerged
  PR #92, so `apps/desktop/src-tauri/Cargo.lock` still resolved `plist v1.9.0` → `quick-xml
  v0.39.2`. Both advisories affect `quick-xml < 0.41.0`:
  - RUSTSEC-2026-0194 — quadratic run time when checking a start tag for duplicate attribute
    names (high, 7.5).
  - RUSTSEC-2026-0195 — unbounded namespace-declaration allocation in `NsReader` enabling
    memory-exhaustion DoS.

  Verified via crates.io dependency metadata that `plist 1.9.0` requires `quick-xml ^0.39.2`
  (vulnerable) while `plist 1.10.0` (released 2026-07-04) requires `quick-xml ^0.41.0` (patched).
  Re-applied the fix with:
  ```
  cargo update -p plist --precise 1.10.0 --manifest-path apps/desktop/src-tauri/Cargo.toml
  ```
  This bumped `plist 1.9.0 → 1.10.0` and transitively `quick-xml 0.39.2 → 0.41.0` in
  `Cargo.lock` (4 lines changed, no `Cargo.toml` edits needed — `plist` is a transitive dep of
  `tauri-utils`, not declared directly).

  Did **not** re-apply the Dependabot/`weekly-audit.yml` coverage extensions from PR #92 — those
  are unrelated infra changes, not security-critical, and are left for that PR's own review since
  we were asked not to copy it wholesale. Current staging tip already has the baseline Dependabot
  config (npm + cargo + github-actions, all targeting `staging`) and `weekly-audit.yml` (npm audit
  only) from the 2026-06-24 cycle; neither has grown since.

- **Safe npm updates** — `npm update` at root picked up in-range patch/minor bumps across all
  workspaces (no `package.json` range changes required):

  | Workspace | Package | Before | After |
  |---|---|---|---|
  | root | `eslint` | 10.6.0 | 10.7.0 |
  | root | `@types/node` | 25.9.4 | 25.9.5 |
  | root | `typescript-eslint` (+ sub-packages) | 8.62.1 | 8.64.0 |
  | `services/api` | `@langchain/langgraph` | 1.4.7 | 1.4.8 |
  | `services/api` | `helmet` | 8.2.0 | 8.3.0 |
  | (transitive, various) | brotli, chrono-adjacent JS deps, etc. | — | patch bumps only |

  `apps/desktop` and `shared/schemas` had nothing outdated within range this cycle.
  `services/eval` had nothing outdated.

### Security audit results

| Check | Result |
|---|---|
| `npm audit` (all workspaces, before fix) | 0 vulnerabilities |
| `npm audit` (all workspaces, after fix) | 0 vulnerabilities |
| `pip-audit` | Skipped — no Python runtime deps declared (`dependencies = []`) |
| `cargo audit` | Could not run the `cargo-audit` binary in this environment — attempting `cargo install cargo-audit` failed to compile here due to a pre-existing sandbox toolchain limitation (see Notes). Cross-checked the known advisory manually instead, against the RustSec advisory database and crates.io dependency metadata (see Fixes applied above). No other RUSTSEC advisories were identified for crates in `Cargo.lock` during this manual pass, but this is **not** as exhaustive as a real `cargo audit` run — flagging as a residual verification gap for next cycle or for CI to close (see Notes). |

### Notes

- **Lock file drift (pre-existing, not fixed this cycle, call for repo owner)** — `package-lock.json`
  and `pnpm-lock.yaml` still coexist at the root. CI only reads `package-lock.json` (`npm ci`).
  `pnpm-lock.yaml` was last modified 2026-05-31; `package-lock.json` was just updated today
  (2026-07-15) as part of this cycle's dependency bumps. The gap between the two is now **~6.5
  weeks and growing every cycle** the pnpm file isn't touched. Per standing guidance, did not
  delete either file — this remains a decision for the repo owner (drop `pnpm-lock.yaml`, or wire
  CI/Dependabot to keep both in sync).
- **Rust build/test not verifiable in this sandbox** — `cargo check`/`cargo test` for
  `apps/desktop/src-tauri` fail in this execution environment for reasons unrelated to today's
  dependency changes: (1) the committed `binaries/node-x86_64-unknown-linux-gnu` sidecar symlink
  points at `/usr/bin/node`, which doesn't exist in this sandbox (node lives at
  `/opt/node22/bin/node` here) even though the binaries' own README says these should never be
  committed; (2) a `phf_macros`/`system-deps` build step fails here with "the self-contained
  linker was requested, but it wasn't found in the target's sysroot" — a toolchain-completeness
  issue in this sandbox, not a code or dependency problem. Neither failure reproduces in GitHub
  CI, and `.github/workflows/ci.yml` does not currently run any `cargo` step at all (Rust
  security coverage is Dependabot-only, per the 2026-06-24 note) — so this couldn't be
  cross-checked against a green CI Rust run either. The targeted `plist`/`quick-xml`
  `Cargo.lock` update was verified against upstream dependency metadata instead of a local
  build; recommend a real `cargo check`/`cargo test` pass (outside this sandbox) before or via
  the PR's own review.
- Re-ran `npm run lint`, `npm run typecheck`, `npm run test` (all workspaces), and
  `apps/desktop`'s `npm run build` after every dependency change — all still green, identical
  pass counts to baseline (desktop 222/221 pass tests unchanged, api 423/423, eval 16/16,
  schemas 17/17; lint and typecheck clean).

### Major upgrades pending (manual review — not applied)

| Package | Current | Latest | Risk notes |
|---|---|---|---|
| `typescript` (root) | `6.0.3` | `7.0.2` | Major bump, flagged in prior cycles too. Pulls in `typescript-eslint`/`@typescript-eslint/*` compatibility questions; needs a dedicated upgrade pass + full lint/typecheck/test re-run, not a drive-by bump. |
| `@types/node` (root) | `25.9.5` | `26.1.1` | Major bump tracking a newer Node major; project's `engines.node` is `>=22` and CI pins Node 22 — bumping types to 26 ahead of an actual Node runtime bump risks type/runtime mismatches. Re-evaluate together with any future Node engine bump. |

No other workspace (`apps/desktop`, `services/api`, `services/eval`, `shared/schemas`) has a
pending major this cycle — `@tauri-apps/*`, `react`/`react-dom`, `express`, `zod`,
`@langchain/*`, `better-sqlite3`, `pg`, etc. are all on current majors.

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

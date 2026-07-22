# Maintenance Log

Weekly dependency and health checks for the Bandsearch application.

---

## 2026-07-22

### Backlog warning — read this first

Four PRs from prior maintenance cycles are still open and unmerged against `staging`,
all created 2026-07-08 or 2026-07-15:

| PR | Date | Contents |
|---|---|---|
| [#92](https://github.com/eikrad/bandsearch-app/pull/92) | 2026-07-08 | Maintenance: quick-xml/plist CVE fix (`cargo update -p plist --precise 1.10.0`), Dependabot `uv` ecosystem entry + directory-path bugfix, `weekly-audit.yml` extended with `pip-audit`/`cargo-audit` |
| [#93](https://github.com/eikrad/bandsearch-app/pull/93) | 2026-07-08 | Docs: `CONTRIBUTING.md`, `ROADMAP.md`, `ARCHITECTURE.md` drift fixes |
| [#94](https://github.com/eikrad/bandsearch-app/pull/94) | 2026-07-15 | Maintenance: same quick-xml/plist CVE fix (re-applied independently since #92 hadn't landed), npm patch/minor bumps |
| [#95](https://github.com/eikrad/bandsearch-app/pull/95) | 2026-07-15 | Docs: `ARCHITECTURE.md` sync (`enrich_lastfm` node, `obscurityTarget`, desktop routes) |

**This PR does not touch any of them.** Every cycle that lands on top of `staging` without
these merging first repeats the same CVE fix and grows lockfile churn. Recommend the repo
owner review and either merge or close this backlog before/alongside this cycle's PR —
in particular, verify directly whether #92's and #94's `plist`/`quick-xml` fix is
independently duplicated here (it is — see below) before merging more than one of them.

### Checks performed
- `git fetch origin staging` + reset working branch to `staging` tip (`617d586`) before starting
- Verified directly (not assumed) whether PR #92's `plist`/`quick-xml` CVE fix was already on
  `staging`: it was **not** — `origin/staging`'s `apps/desktop/src-tauri/Cargo.lock` still
  resolved `plist 1.9.0` / `quick-xml 0.39.2` at the start of this cycle
- Full baseline (lint, typecheck, test, desktop build) before and after changes
- `npm outdated` per workspace (root, `apps/desktop`, `services/api`, `services/eval`, `shared/schemas`)
- `npm audit` before and after
- `cargo audit` — **ran successfully this cycle** (prior cycle's `phf_macros`/linker issue did
  not reproduce here; `cargo-audit 0.22.2` installed and ran cleanly)
- Confirmed Python (`pyproject.toml` `dependencies = []`, `uv.lock` has no third-party entries) —
  still nothing to audit or update
- Re-checked `.github/workflows/ci.yml` Node version (`22`) against `engines: ">=22"` — still consistent

### Security fix (high severity, applied)

`cargo audit` confirmed the same two advisories flagged by #92/#94, still present on `staging`:
- **RUSTSEC-2026-0194** — quadratic run time when checking a start tag for duplicate attribute names (CVSS 7.5, high)
- **RUSTSEC-2026-0195** — unbounded namespace-declaration allocation in `NsReader` → memory-exhaustion DoS (CVSS 7.5, high)

Both in `quick-xml 0.39.2`, pulled transitively via `plist 1.9.0` (used by `tauri-utils` for
Info.plist generation). Fixed the same way as the pending PRs:

```
cargo update -p plist --precise 1.10.0
```

`plist 1.10.0` requires `quick-xml ^0.41.0`, resolving the vulnerable version. Stays within
`tauri`'s declared range — only `Cargo.lock` changed (4 lines: `plist` + `quick-xml` version/checksum).
Re-ran `cargo audit` after: **0 vulnerabilities** (down from 2 high). 18 informational
unmaintained/unsound warnings remain (transitive GTK3 bindings inside `tauri` itself — `atk`,
`gdk`, `gtk`, `gtk-sys` family, plus `proc-macro-error`, `unic-*`, `anyhow` `Error::downcast_mut`
unsoundness, `glib` iterator unsoundness). None have an independently-updatable fix; same set
noted in the 2026-07-08 cycle.

**Note for the repo owner:** this is the *third* time this exact fix has been produced
independently (#92, #94, and now this cycle) because none of the PRs carrying it have merged.
Merging any one of #92/#94 (or this PR) resolves it for `staging`; the other two become no-ops
that should be closed rather than merged.

### Safe (patch/minor) dependency updates applied — `npm update`

| Workspace | Package | Before | After |
|---|---|---|---|
| root | `eslint` | `10.6.0` | `10.7.0` |
| root | `tsx` | `4.22.4` | `4.23.1` |
| root | `typescript-eslint` | `8.62.1` | `8.65.0` |
| root | `@types/node` | `25.9.4` | `25.9.5` |
| `apps/desktop` | `react` | `19.2.7` | `19.2.8` |
| `apps/desktop` | `react-dom` | `19.2.7` | `19.2.8` |
| `services/api` | `@langchain/langgraph` | `1.4.7` | `1.4.8` |
| `services/api` | `express-rate-limit` | `8.5.2` | `8.6.0` |
| `services/api` | `helmet` | `8.2.0` | `8.3.0` |

`services/eval` and `shared/schemas` had nothing outdated this cycle. All bumps were within
existing `^` constraints — no `package.json` range edits needed, only `package-lock.json`
(190 insertions / 171 deletions). This `npm update` also incidentally cleared the two
vulnerabilities `npm audit` reported at baseline (`body-parser` DoS, `brace-expansion` DoS —
both transitive, fixed by the patch-level resolution bump, no direct action needed).

Rust: only the security-driven `plist` bump above was applied. `cargo update --dry-run`
shows a broader set of patch/minor bumps available across the `tauri` 2.x family (`tauri
2.11.0→2.11.5`, `tauri-build 2.6.0→2.6.3`, `tokio 1.52.1→1.53.1`, `wry`, `zbus`, `time`, etc.)
— none tied to an advisory, so left unapplied this cycle to keep the security PR's diff
minimal and reviewable; flagging as available for a future cycle or the repo owner's discretion.

### Major upgrades — flagged, NOT applied (pending manual review)

| Package | Current | Latest | Why held back |
|---|---|---|---|
| `typescript` (root) | `6.0.3` | `7.0.2` | Major rewrite; flagged every cycle since 2026-07-08; needs a dedicated compatibility pass with `typescript-eslint` across all 4 npm workspaces |
| `@types/node` (root) | `25.9.5` | `26.1.1` | Type-defs major ahead of the `engines: ">=22"` floor / CI's pinned Node 22 — low risk but flagged per policy |
| `better-sqlite3` (`services/api`) | `12.11.1` | `13.0.1` | New major this cycle (not flagged before); native-addon rebuild risk, needs its own verification pass before bumping |

No other workspace has a pending major (`@tauri-apps/*`, `express`, `zod`, `@langchain/*`, `pg`, etc. all current).

### Security audit results

| Ecosystem | Tool | Result |
|---|---|---|
| npm (all workspaces) | `npm audit` | 2 (1 low, 1 high) at baseline → **0 after `npm update`** |
| Python (root) | manual (`dependencies = []`, `uv.lock` has no third-party entries) | Nothing to audit — confirmed |
| Rust (`apps/desktop/src-tauri`) | `cargo audit` | 2 high (RUSTSEC-2026-0194, -0195) → **fixed this cycle**; 0 vulnerabilities remaining; 18 informational unmaintained/unsound warnings unchanged (see above) |

### Known issue — dual lock files (not fixed, flagging again)

`package-lock.json` (root) and `pnpm-lock.yaml` still coexist. `pnpm-lock.yaml` was last
committed 2026-05-31 — now **~7.5 weeks stale** and growing every cycle it isn't touched or
removed, while `package-lock.json` was updated again by this cycle's `npm update`. CI uses
`npm ci` (reads only `package-lock.json`), so local `pnpm install` usage would diverge from
CI. **Not resolved in this PR** — deleting either lockfile is a call for the repo owner, not an agent.

### Sandbox/toolchain notes

- `cargo audit` ran cleanly this cycle (installed `cargo-audit 0.22.2` from source without
  issue) — the `phf_macros`/linker problem noted in the 2026-07-15 cycle did not reproduce here.
- `cargo check` / `cargo build` (`apps/desktop/src-tauri`) still **cannot complete** in this
  sandbox: `gdk-sys` (transitive GTK3 dependency via `tauri`) requires `gdk-3.0.pc` via
  `pkg-config`, and only GTK3 runtime libraries are present here, not the `-dev`/pkg-config
  files. Attempted `apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev` — partially blocked by
  404s from the mirror for several transitive packages (`xdg-desktop-portal`, `webkit2gtk`,
  `gdk-pixbuf`, etc.), so the dev headers could not be installed. This is an environment
  limitation, not a code issue — same category of gap noted in the 2026-07-15 cycle (missing
  self-contained linker) though the specific cause differs this time. Recommend a real
  `cargo check`/`cargo test` pass on a machine with full GTK3 dev packages (or in CI, which
  currently has no `cargo` step) before merging any Rust dependency change, including this one.
- JS/TS side fully verifiable: `npm run lint`, `npm run typecheck`, `npm run test`, and
  `npm --workspace @bandsearch/desktop run build` all ran to completion in this sandbox.

### Post-change verification

Re-ran the full baseline suite after all changes — identical to pre-change baseline:
- `npm run lint` — clean (root + all workspaces + Python ruff/black)
- `npm run typecheck` — clean (desktop, api, schemas)
- `npm run test` — **678/678** (677 pass + 1 pre-existing skip, 0 fail) — desktop 222
  (221 pass, 1 skip), api 423, eval 16, schemas 17 — same counts as baseline
- `apps/desktop` `npm run build` — succeeds
- `cargo audit` (`apps/desktop/src-tauri`) — 0 vulnerabilities after the `plist` bump
- `cargo check`/`cargo test` — not verifiable in this sandbox (GTK3 dev headers missing, see above)

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

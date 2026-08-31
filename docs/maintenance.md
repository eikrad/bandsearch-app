# Maintenance Log

Weekly dependency and health checks for the Bandsearch application.

---

## 2026-08-26

### Checks performed
- `git fetch origin staging` then `git merge --ff-only origin/staging` — reported "Already up to
  date." The working branch (`claude/eloquent-volta-u683om`) was seeded from `origin/main`'s tip
  (`f88d073`, "Merge pull request #130 from eikrad/staging") rather than `origin/staging`'s
  (`09400b9`), same recurring pattern as 2026-08-12 and 2026-07-15. Investigated before trusting
  the ff-only result: `git merge-base --is-ancestor origin/staging HEAD` confirmed `origin/staging`
  is a real ancestor of `HEAD`, and `git diff --stat origin/staging HEAD` was empty — the one
  "ahead" commit is a no-diff merge of `staging` into `main`, identical in content to
  `origin/staging`'s tip. Same "seeded from `main`, but content-identical" situation as 2026-08-12's
  `383ce9a`, not a real divergence. Working tree confirmed clean before starting.
- Matched local toolchain to CI (`node-version: 26` in both jobs of `.github/workflows/ci.yml`,
  `engines: ">=26"` in root `package.json`): default sandbox Node was `v22.22.2`; installed Node 26
  via `nvm install 26` → resolved `v26.8.0`. **New finding this cycle**: this sandbox's Node 26
  build reports `process.version` as `v26.8.0-alpha.0.0.0` (not the plain `v26.8.0` its own
  `/versions/node/v26.8.0/` install path implies), which broke `npm ci` outright — `node-gyp`
  derives the release-headers URL from `process.version` and requested
  `.../v26.8.0-alpha.0.0.0/node-v26.8.0-alpha.0.0.0-headers.tar.gz`, a 404 (verified the real,
  correctly-versioned headers exist at `.../v26.8.0/node-v26.8.0-headers.tar.gz`). This is a
  sandbox/nvm-mirror labeling artifact, not a repo defect — GitHub-hosted runners via
  `actions/setup-node@v7` pull the official, correctly-versioned Node 26 build and would never hit
  this. Reproduced twice (plain `npm ci` fails deterministically both times) before working around
  it locally with `npm_config_target=26.8.0 npm ci` (overrides node-gyp's derived target version
  without touching any repo file) to get a trustworthy local baseline. Same "false failure from a
  sandbox Node-build quirk" category as 2026-08-19's Node 22-vs-26 `mock.module` finding, different
  specific mechanism this time.
- Baseline `npm ci` (with the above workaround) + `npm run ci` (lint+typecheck+test) + `npm run
  build --workspace @bandsearch/desktop` (mirrors the `e2e` job's build step) — **fully green**
  before any changes: lint clean, typecheck clean, tests 722/723 (desktop 226/227 pass + 1
  pre-existing skip, api 454/454, eval 16/16, schemas 25/25), build clean.
- `npm audit` (workspace-wide), `uv export --format requirements-txt --no-hashes` + `pip-audit`,
  `cargo audit --file apps/desktop/src-tauri/Cargo.lock` (installed `cargo-audit` 0.22.2 fresh,
  ~5 min compile, not cached in this sandbox) — all re-run rather than trusting last cycle.
- `npm outdated` per workspace (root, `apps/desktop`, `services/api`, `services/eval`,
  `shared/schemas`) — **note**: `npm outdated --workspaces --include-workspace-root` (the combined
  form used in prior cycles) silently returned `{}` in this npm version (11.19.0, bundled with this
  sandbox's Node 26 build) even though real outdated packages existed; ran per-workspace instead
  (`npm outdated --json` at root, then `-w <workspace>` for each) which correctly surfaced them.
  Worth using the per-workspace form next cycle too until confirmed fixed upstream.
- `uv pip list --outdated` — reconfirmed `pyproject.toml` still declares `dependencies = []`
  (nothing installed, nothing to be outdated).
- `cargo update --dry-run --manifest-path apps/desktop/src-tauri/Cargo.toml` — 143 packages have
  newer in-range versions available. Cross-referenced the diff against the `cargo audit` informational
  warnings list and found two (`event-listener`, `anyhow`) are RustSec advisories with a real patched
  version available in-range — see Fixes applied.
- Re-verified the `typescript` v7 block specifically for this repo (not carried over from
  Job-Tracker): `npm view typescript-eslint@8.68.0 peerDependencies` (the version this cycle bumped
  to) still declares `"typescript": ">=4.8.4 <6.1.0"` — identical range to the previously-installed
  8.67.0, so TS7 (`6.0.3` → `7.0.2`) is still out of range. Checked upstream
  `typescript-eslint/typescript-eslint#10940` directly (still **open**): it's about integrating
  TypeScript 7's Go-based `tsgo`/`typescript-go` implementation, blocked on ESLint lacking an async
  parser API plus `tsgo` itself still being pre-stable — maintainers note this is unlikely to land
  for another 1–2 TS-eslint majors, not a near-term fix.
- Checked `.github/dependabot.yml` — unchanged since 2026-07-08 (npm root, cargo at
  `/apps/desktop/src-tauri`, uv at `/`, github-actions, all → `staging`). Confirmed via `git log`
  on `pnpm-lock.yaml`/`package-lock.json` (see Notes) rather than assuming prior cycles' "growing
  gap" framing still holds.
- Attempted `apps/desktop/src-tauri` Rust build verification, which every prior cycle since
  2026-07-08 could not do in-sandbox (GTK3 pkg-config gap or missing Node sidecar symlink). This
  cycle `pkg-config --exists gdk-3.0` / `webkit2gtk-4.1` both succeeded (dev headers now present in
  this sandbox — an environment change, not a repo change). Temporarily created the local-dev-only
  sidecar symlink per `apps/desktop/src-tauri/binaries/README`'s documented command
  (`ln -sf "$(which node)" binaries/node-x86_64-unknown-linux-gnu`), ran `cargo check` and
  `cargo test`, then **deleted the symlink again** before committing (README: "these binaries are
  NOT committed to the repository" — confirmed `git status` showed no trace of it afterward).
- Re-ran the full `npm run ci` suite + desktop build + `cargo test` (all Node 26, workaround
  applied) after every change.

### CI health (staging)
Confirmed clean per task framing (zero open Dependabot PRs, zero open `security-audit` issues, PR
#131 open/green and unrelated/untouched). Not independently re-queried against the Actions API
this cycle beyond that framing since nothing surfaced to contradict it.

### Fixes applied

- **Rust — informational/unsound advisories, 2 of 19 resolved via in-range `Cargo.lock` bump.**
  `cargo audit` baseline: 0 vulnerabilities, 19 informational unmaintained/unsound warnings (same
  set as every prior cycle). Cross-checked `cargo update --dry-run`'s available bumps against the
  RustSec advisory files directly (`~/.cargo/advisory-db`) rather than assuming "informational
  means unfixable" — two turned out to have real patched versions in-range of `Cargo.toml`'s
  existing constraints (both are transitive deps, no `Cargo.toml` edit needed):

  | Crate | Advisory | Before | Patched (per advisory) | After |
  |---|---|---|---|---|
  | `event-listener` (transitive, via `tauri`/`async-*`) | RUSTSEC-2026-0221 (`!Send` tag crosses thread boundary via `StackSlot`) | 5.4.1 | `>= 5.4.2` | 5.4.2 |
  | `anyhow` (transitive) | RUSTSEC-2026-0190 (`Error::downcast_mut()` unsoundness) | 1.0.102 | `>= 1.0.103` | 1.0.104 |

  Applied with targeted `cargo update -p <crate> --precise <version>` (same pattern as the
  2026-07-15/2026-07-08 `plist`/`quick-xml` fixes) rather than a blanket `cargo update`, to keep the
  diff minimal and avoid mixing in 141 unrelated non-security bumps. `Cargo.lock` diff: 9 lines (4
  insertions / 5 deletions), no `Cargo.toml` changes. Re-ran `cargo audit`: **19 → 17 informational
  warnings**, still 0 vulnerabilities. Verified with a real `cargo check` + `cargo test` (see Checks
  performed) — **21/21 Rust unit tests pass** (one more than the 20/20 last actually run in the
  2026-07-08 cycle; a test was added since). The remaining 17 warnings (GTK3 `gtk-rs` bindings ×9,
  `proc-macro-error`, `unic-*` ×5, `glib` iterator unsoundness) still have no independently-fixable
  upstream version — unchanged from every prior cycle's assessment.

- **npm — no new security vulnerabilities this cycle.** `npm audit`: **0 vulnerabilities**
  (workspace-wide), both before and after updates.

- **Safe npm updates** — `npm update` targeted at the packages `npm outdated` (run per-workspace,
  see Checks performed) flagged as in-range, all root `devDependencies` (no `package.json` range
  changes needed, all already used caret ranges):

  | Workspace | Package | Before | After |
  |---|---|---|---|
  | root | `@types/node` | 26.2.0 | 26.3.0 |
  | root | `@types/react-dom` | 19.2.4 | 19.2.5 |
  | root | `eslint` | 10.8.1 | 10.9.1 |
  | root | `typescript-eslint` (+ `@typescript-eslint/*` sub-packages) | 8.67.0 | 8.68.0 |

  `apps/desktop`, `services/api`, `services/eval`, `shared/schemas` had **nothing outdated** this
  cycle (all already at latest in-range, including `@langchain/langgraph` 1.4.12 and
  `@langchain/google-genai` 2.3.0, merged via Dependabot before this cycle started). `pg`,
  `@types/pg`, `better-sqlite3`, `@tursodatabase/sync` (still 0.7.2, unchanged, per the
  fragility note — nothing available to bump anyway) all current.

  Only `package-lock.json` changed (148 lines: 74 insertions / 74 deletions). `pnpm-lock.yaml` was
  **not** regenerated — see Notes for this cycle's (improved) divergence picture.

### Majors — flagged, NOT applied

| Package | Current | Latest | Why held back |
|---|---|---|---|
| `typescript` (root) | 6.0.3 | 7.0.2 | Major rewrite, flagged every cycle since 07-08 — still blocked. Re-verified specifically for this repo this cycle (not assumed from the sibling Job-Tracker finding): `typescript-eslint@8.68.0` (this cycle's own latest) still declares peer `"typescript": ">=4.8.4 <6.1.0"`; upstream `typescript-eslint/typescript-eslint#10940` (TS7/`tsgo` support) remains open and is explicitly described by maintainers as unlikely to land within 1–2 of their own majors. |

No other npm, Rust, or Python major was outstanding this cycle.

### Security audit results

| Ecosystem | Tool | Result |
|---|---|---|
| npm (all workspaces) | `npm audit` | **0 vulnerabilities** (baseline and after updates) |
| Python | `pip-audit` (via `uv export`) | **0 vulnerabilities** — `dependencies = []` in `pyproject.toml`, nothing to audit, reconfirmed |
| Rust | `cargo audit` 0.22.2 (518 crate deps scanned) | 0 vulnerabilities before and after. **19 → 17 informational warnings** — 2 resolved this cycle (`event-listener` RUSTSEC-2026-0221, `anyhow` RUSTSEC-2026-0190, see Fixes applied); 17 remain (GTK3 `gtk-rs` bindings ×9, `proc-macro-error`, `unic-*` ×5, `glib` iterator unsoundness), all transitive through `tauri`'s GTK3 Linux backend with no independently-fixable upstream version. |
| GitHub | `security-audit`-labeled issues | 0 open (per task framing, not independently re-queried this cycle) |

### Notes

- **Lock file divergence — smaller and apparently no longer abandoned (re-measured, not assumed
  from prior cycles).** Every cycle since 2026-06-10 has flagged `pnpm-lock.yaml` as growing stale
  dead weight (up to ~6.5 weeks behind by 2026-07-15). This cycle it's a different picture: `git log
  -1 -- pnpm-lock.yaml` shows it was last committed **2026-08-25 — the day before this cycle**,
  and diffing actual resolved versions (not just the commit date) shows it already matches
  `package-lock.json`'s *pre-cycle* state for the packages checked (`@langchain/langgraph@1.4.12`,
  `better-sqlite3@13.0.3`) — it just doesn't yet reflect this cycle's own bumps
  (`typescript-eslint@8.67.0` in `pnpm-lock.yaml` vs. `8.68.0` now in `package-lock.json`), which is
  expected for a file nobody in this routine touches. `.github/dependabot.yml` and every workflow
  still only cover/run npm, so `package-lock.json` remains the sole tool of record — but someone
  (outside this maintenance routine) appears to be keeping `pnpm-lock.yaml` reasonably current by
  hand now, worth the owner confirming intent (adopt pnpm for real, or this is incidental and will
  drift again) rather than continuing to flag it as unowned dead weight by default.
- **New finding — root `package.json`'s `allowScripts` allowlist is stale against currently-pinned
  versions.** `npm ci`/`npm install` now warns `2 packages have install scripts not yet covered by
  allowScripts: better-sqlite3@13.0.3 (install: node-gyp rebuild), esbuild@0.28.2 (postinstall: node
  install.js)` — but `package.json`'s `allowScripts` block still pins the old
  `better-sqlite3@12.11.1` / `esbuild@0.28.1` (pre-dating this repo's own already-merged
  `better-sqlite3` 12→13 major and a subsequent esbuild patch bump). This appears to be npm 11.19's
  install-script governance (bundled with this cycle's Node 26; not present under the sandbox's
  default npm 10.9.7 under Node 22, so this is the first cycle positioned to notice it). Currently
  **advisory-only, not build-breaking**: verified `better-sqlite3` still loads and queries
  correctly (`require('better-sqlite3')(':memory:')` round-tripped a query) because it ships
  pre-built binaries in `prebuilds/` and doesn't strictly need its install script to run on common
  platforms — confirmed via a full `npm run ci` pass, fully green either way. Not fixed this cycle
  (editing a supply-chain allowlist felt outside "safe patch/minor dependency bump" scope), but
  flagging with the exact stale/current version pairs so the owner can decide whether to update the
  `allowScripts` keys to `better-sqlite3@13.0.3` / `esbuild@0.28.2` (or drop the block if it's no
  longer serving its purpose) before a future cycle where a script's actually being skipped starts
  to matter.
- **`npm outdated --workspaces --include-workspace-root` returned `{}` incorrectly this cycle**
  under npm 11.19.0 (this sandbox's Node 26 build) even with real outdated packages present at
  root — worked around by running it per-workspace instead (see Checks performed). Not a repo
  issue; flagging in case it reproduces in a future cycle's sandbox and costs time re-diagnosing.
- **Sandbox Node 26 build mislabeled as `v26.8.0-alpha.0.0.0`, broke `npm ci` outright until
  worked around** — see Checks performed for the full mechanism. Recommend nothing repo-side; this
  is purely this sandbox's `nvm` mirror, and CI's `actions/setup-node@v7` pulls a normal,
  correctly-versioned Node 26.
- **`.husky/pre-commit` runs under whatever Node the ambient shell defaults to, not whatever
  version an interactive `nvm use` selected earlier in the session** — the first commit attempt
  this cycle ran the hook's `npm test` under the sandbox's default Node 22 (despite `npm run ci`
  having just passed clean under Node 26 moments before), hit the exact `apps/desktop/test/
  browser-entry.test.ts` `bootBrowserDesktopApp is not a function` `mock.module` failure documented
  in the 2026-08-19 entry, and aborted the commit (`husky - pre-commit script failed (code 1)`) —
  a session-mechanics quirk (`nvm use` doesn't persist across separate shell invocations here), not
  a new repo issue. Re-ran the commit with Node 26 explicitly selected in the same shell invocation
  as `git commit`, which let the hook's `npm test` pass and the commit land normally. Worth
  remembering for the commit step specifically, not just the baseline-check step, next cycle.
- **Rust build/test actually verifiable this cycle**, unlike every cycle since 2026-07-08 — this
  sandbox now has the GTK3 `-dev`/pkg-config packages present (`pkg-config --exists gdk-3.0` /
  `webkit2gtk-4.1` both succeed, where prior cycles hit either a 404'd apt mirror or missing
  headers). Used the local-dev-only Node sidecar symlink documented in
  `apps/desktop/src-tauri/binaries/README`, ran `cargo check` + `cargo test` (21/21 pass), then
  removed the symlink before committing anything (confirmed `git status` clean of it). Worth
  keeping this cargo-verification step in future cycles' baselines now that it's actually possible
  here, rather than reflexively assuming it will fail again.
- Re-ran `npm run ci` (lint+typecheck+test, all workspaces) and `npm run build --workspace
  @bandsearch/desktop` on Node 26 after all dependency updates — all still green, identical pass
  counts to baseline: **722/723 tests** (desktop 226/227 pass + 1 pre-existing skip, api 454/454,
  eval 16/16, schemas 25/25); lint and typecheck clean. `api`'s count grew from 424 (2026-08-19) to
  454 — accounted for by PR #131's already-merged EU AI Act/GDPR transparency feature, not by
  anything this cycle touched. `test:e2e` was not run — no user-facing code was touched this cycle
  (lockfile-only npm bumps + a transitive `Cargo.lock` bump).

---

## 2026-08-19

### Checks performed
- `git fetch origin staging` then `git reset --hard origin/staging` (`6168af7`, merge of #120) —
  the working branch (`claude/eloquent-volta-jdicez`) did not exist on the remote yet this cycle,
  so this was a clean start rather than a correction. Confirmed working tree clean afterward.
- Confirmed via `.github/workflows/ci.yml` (`cache: npm`, `npm ci`) and `.github/workflows/
  weekly-audit.yml` (same) that npm/`package-lock.json` is the tool of record, not
  `pnpm-lock.yaml`/`pnpm-workspace.yaml` — reconfirmed rather than assumed.
- Baseline `npm ci` + `npm run ci` (lint+typecheck+test) on the sandbox's default Node 22 hit one
  failure: `apps/desktop/test/browser-entry.test.ts` (`bootBrowserDesktopApp is not a function`)
  via `node:test`'s `mock.module`/`--experimental-test-module-mocks`. Rather than treat this as a
  repo bug, installed real Node 26 via `nvm` (matching `engines: ">=26"` and CI's pinned version),
  reinstalled (`npm ci`), and re-ran — **fully green, 0 failures**. Root cause was a Node
  22-vs-26 behavioral difference in the experimental mock-module API, not a code defect; CI itself
  runs Node 26 so this was never actually broken on `staging`.
- `npm audit` (workspace-wide), `uv export --format requirements-txt --no-hashes` + `pip-audit`,
  and `cargo audit --file apps/desktop/src-tauri/Cargo.lock` (installed `cargo-audit` 0.22.2, not
  cached in this sandbox) — all re-run fresh rather than trusting Monday's automated run.
- `npm outdated` across all workspaces; attempted `cargo install cargo-outdated` (timed out after
  3 minutes mid-compile in this sandbox — not installed, not blocking since Cargo is already a
  Dependabot-covered ecosystem and `cargo audit` came back clean) and `uv pip list --outdated`
  (clean — `pyproject.toml` still declares `dependencies = []`).
- Compared `package-lock.json` vs `pnpm-lock.yaml` resolved versions directly (not just file
  mtimes) to check for real divergence, not just staleness.
- Re-ran the full `npm run ci` suite (Node 26) after applying updates.

### CI health (staging)
Confirmed clean per task framing (zero open PRs, zero open `security-audit` issues, last several
`CI` runs on `staging` all `success` — mostly this past Monday's Dependabot merges). Not
independently re-queried this cycle beyond that framing since nothing was found to contradict it.

### Fixes applied

- **No repo bugs found.** The Node 22 test failure above was a sandbox/tooling artifact, not a
  `staging` defect — nothing to fix in the codebase.

- **npm — no new security vulnerabilities this cycle.** `npm audit`: **0 vulnerabilities**
  (workspace-wide), both before and after updates.

- **Safe npm updates** — `npm update` targeted at the two packages `npm outdated` flagged as
  in-range (no `package.json` range changes needed, both already used caret ranges):

  | Workspace | Package | Before | After |
  |---|---|---|---|
  | `services/api` | `@langchain/langgraph` | 1.4.9 | 1.4.10 |
  | root | `@types/pg` | 8.21.0 | 8.23.1 |

  Only `package-lock.json` changed (20 lines: 10 insertions / 10 deletions). `pnpm-lock.yaml` was
  **not** regenerated — see Notes below for why, and the divergence this surfaced.

### Majors — flagged, NOT applied

| Package | Current | Latest | Why held back |
|---|---|---|---|
| `typescript` (root) | 6.0.3 | 7.0.2 | Major rewrite, flagged every cycle since 07-08 — still unresolved; needs a dedicated compatibility pass across all 4 npm workspaces + `typescript-eslint`. |

No other npm, Rust, or Python major was outstanding this cycle.

### Security audit results

| Ecosystem | Tool | Result |
|---|---|---|
| npm (all workspaces) | `npm audit` | **0 vulnerabilities** (baseline and after updates) |
| Python | `pip-audit` (via `uv export`) | **0 vulnerabilities** — `dependencies = []` in `pyproject.toml`, nothing to audit, reconfirmed rather than assumed |
| Rust | `cargo audit` 0.22.2 (518 crate deps scanned) | **0 vulnerabilities**. 19 informational unmaintained/unsound warnings, same category/count as prior cycles (GTK3 `gtk-rs` bindings ×9, `proc-macro-error`, `unic-*` ×5, `anyhow` `Error::downcast_mut()` unsoundness, `event-listener` `!Send` unsoundness, `glib` iterator unsoundness) — no independent fix available, all transitive through `tauri`'s GTK3 Linux backend. |
| GitHub | `security-audit`-labeled issues | 0 open (per task framing, not independently re-queried this cycle) |

### Notes

- **Lock file divergence confirmed, not just staleness (pre-existing, not fixed this cycle, call
  for repo owner)** — went beyond checking mtimes this cycle and diffed actual resolved versions:
  `package-lock.json` already resolved `@langchain/langgraph` to `1.4.9` before this cycle's
  update, while `pnpm-lock.yaml` was still pinned at `1.3.2` (the exact floor of its own
  `^1.3.2` specifier — i.e. never bumped since introduction). `pnpm-lock.yaml` is not listed in
  `.github/dependabot.yml` (npm ecosystem only tracks `package-lock.json`) and no workflow ever
  runs `pnpm install`, so it is pure dead weight that will keep drifting every cycle. Did not
  regenerate it or delete it — per standing guidance this is the repo owner's call (drop
  `pnpm-lock.yaml`/`pnpm-workspace.yaml`, or wire up real pnpm support) — but flagging with
  concrete evidence of drift now, not just "these files coexist."
- **`cargo-outdated` unavailable this cycle** — `cargo install cargo-outdated --locked` did not
  finish compiling within a 3-minute budget in this sandbox (unlike `cargo-audit`, which
  installed in ~5 min the same session). Not treated as blocking: Cargo is fully covered by
  Dependabot (`.github/dependabot.yml`, weekly) and `cargo audit` found 0 vulnerabilities, so
  there was no security-relevant gap — but a future cycle with more sandbox budget could still
  install it for a non-security "outdated" sweep beyond what Dependabot's PRs already surface.
- Re-ran `npm run ci` (lint+typecheck+test, all workspaces) on Node 26 after the dependency
  updates — all still green, identical pass counts to baseline: **691/692 tests** (desktop
  226/227 pass + 1 pre-existing skip, api 424/424, eval 16/16, schemas 25/25); lint and typecheck
  clean. `test:e2e` was not run — no user-facing code was touched this cycle (pure
  `services/api` + root devDependency lockfile bump).

---

## 2026-08-12

### Checks performed
- `git fetch origin`, then compared the working branch (`claude/eloquent-volta-l94b2x`) against
  `origin/staging`: 0 commits behind, but 1 commit "ahead" (`383ce9a`, PR #102 "Update for Main").
  Investigated before touching anything, per this cycle's instructions — that commit turned out to
  be the merge of `staging` into `main` (already on `origin/main`'s tip, confirmed via
  `git merge-base --is-ancestor`), so it was not unique/unpushed work, just the branch having been
  seeded from `origin/main`'s tip instead of `origin/staging`'s. Reset to `origin/staging`
  (`ff80c78`, merge of #101) — same underlying "seeded from the wrong ref" pattern as the
  2026-07-15 and 2026-08-05 cycles, this time pointing at `main` rather than being stale.
- Confirmed `npm ci` + `cache: npm` in `.github/workflows/ci.yml` and `package-lock.json` (not
  `pnpm-lock.yaml`) is what CI actually installs from — npm/`package-lock.json` is authoritative.
- Baseline: `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm --workspace @bandsearch/desktop run build` — all green before any changes.
- `npm outdated` / `npm audit` across all workspaces (root, `apps/desktop`, `services/api`,
  `services/eval`, `shared/schemas`).
- Confirmed root `pyproject.toml` still declares `dependencies = []` — nothing to audit on the
  Python side, reconfirmed rather than assumed.
- Installed `cargo-audit` 0.22.2 (not cached in this sandbox) via `cargo install cargo-audit
  --locked`, then ran `cargo audit --no-yanked` in `apps/desktop/src-tauri` (yanked-crate checks
  hit `503` from the registry through the sandbox's outbound proxy; the vulnerability/warning scan
  itself is unaffected by that flag).
- Cross-referenced `npm outdated` against the 10 open Dependabot npm/cargo PRs (via `git fetch`
  branch list and `list_pull_requests`) to avoid duplicating any in-flight bump.
- Checked recent CI runs on `staging` via the GitHub Actions API.
- Re-ran the full baseline suite after applying updates.

### CI health (staging)
Most recent `CI` run against `staging`'s current tip (`ff80c78`, run `31590463407`) is
`completed`/`success`. No red runs found in recent history.

### Fixes applied

- **npm — no new security vulnerabilities this cycle.** Baseline `npm audit`: **0 vulnerabilities**
  (workspace-wide). Nothing to fix.

- **Safe npm updates** — applied only where not already covered by an open Dependabot PR
  (`npm update` targeted at specific packages; no `package.json` range changes):

  | Workspace | Package | Before | After |
  |---|---|---|---|
  | root | `typescript-eslint` (+ `@typescript-eslint/*` sub-packages) | 8.66.0 | 8.67.0 |
  | root | `globals` | 17.9.0 | 17.11.0 |
  | `services/api` | `pg` (+ transitive `pg-protocol`) | 8.22.0 → n/a | 8.23.0 / 1.16.0 |

  Only `package-lock.json` changed (142 lines: 71 insertions / 71 deletions). `better-sqlite3`,
  `esbuild`, `eslint`, `tsx` were left untouched despite being outdated — each already has an open
  Dependabot PR (#111, #108, #109, #112) targeting the same or a newer version; bumping them here
  would either duplicate or conflict with those PRs. Note: the open `tsx` PR (#112) targets
  4.23.11, one patch behind the true latest (4.23.12) — left as-is rather than superseding an
  in-flight PR; worth a glance by the owner when merging #112.

- **Rust — no fix needed/applied this cycle.** `cargo audit --no-yanked`: **0 vulnerabilities**,
  19 informational unmaintained/unsound warnings — identical set and count to the 2026-08-05
  cycle (no new advisories this week). `Cargo.lock` still resolves `plist 1.10.0` / `quick-xml
  0.41.0` (RUSTSEC-2026-0194/0195 fix unregressed). `cargo update --dry-run` shows the same
  category of non-security patch/minor bumps across the `tauri` 2.x family as prior cycles (plus
  churn already covered by the open cargo Dependabot PRs #105/#107/#110) — none applied, consistent
  with "keep security-driven PRs minimal" precedent.

### Majors — flagged, NOT applied

| Package | Current | Latest | Why held back |
|---|---|---|---|
| `typescript` (root) | 6.0.3 | 7.0.2 | Major rewrite, flagged every cycle since 07-08; still needs a dedicated compatibility pass across all 4 npm workspaces + `typescript-eslint`. Note: open PR #113 ("complete TypeScript migration with strict mode") may be adjacent to this — worth the owner checking whether #113 also lands the v7 bump before a future cycle attempts it separately. |
| `@types/node` (root) | 25.9.5 | 26.2.0 | Type-defs major ahead of `engines: ">=22"` / CI's pinned Node 22 — low risk but flagged per policy, unchanged from prior cycles. |
| `better-sqlite3` (`services/api`) | 12.11.1 | 13.0.3 | Native-addon major; already has an open Dependabot PR (#111) — not duplicated here, needs its own rebuild/verification pass per prior cycles' notes. |

### Security audit results

| Ecosystem | Tool | Result |
|---|---|---|
| npm (all workspaces) | `npm audit` | **0 vulnerabilities** (baseline and after updates) |
| Python | manual (`dependencies = []` in `pyproject.toml`) | Nothing to audit, reconfirmed |
| Rust | `cargo audit` 0.22.2 (535 crate deps scanned) | **0 vulnerabilities**. 19 informational unmaintained/unsound warnings, unchanged from 2026-08-05 (GTK3 `gtk-rs` bindings ×5, `proc-macro-error`, `unic-char-*`/`unic-common`/`unic-ucd-*` ×6, `anyhow` `Error::downcast_mut()` unsoundness, `event-listener` `!Send` unsoundness, `glib` iterator unsoundness) — no independent fix available. |
| GitHub | `security-audit`-labeled issues | 0 open issues (repo-wide) — reverified fresh rather than assumed from last week. |

### Open-PR backlog — flag for owner

**11 PRs are currently open against `staging`** (#103–#112 Dependabot bumps across npm/cargo/
github-actions, plus #113 a large manual "complete TypeScript migration with strict mode" PR) with
none merged since at least the 2026-08-05 cycle. This is a sizeable, growing backlog — prior
cycles' logs have flagged pileups like this before, and it's worth the owner's attention: either a
batch-review/merge session for the low-risk Dependabot PRs, or an explicit decision to let them
keep queuing. Per this cycle's constraints, none of the 11 were merged, closed, or edited — only
this cycle's own PR was opened.

### Notes

- **Lock file drift (pre-existing, not fixed this cycle, call for repo owner)** —
  `package-lock.json` and `pnpm-lock.yaml` (+ `pnpm-workspace.yaml`) still coexist at the root.
  Reconfirmed this cycle that CI (`.github/workflows/ci.yml`) only ever runs `npm ci` (with
  `cache: npm`) and every `package.json` script in this repo invokes `npm`/`npx` — so
  `package-lock.json` is the ecosystem CI and this maintenance routine actually depend on, and
  `pnpm-lock.yaml`/`pnpm-workspace.yaml` look like unintentional drift (an abandoned pnpm
  experiment, or a stale artifact from before the repo settled on npm workspaces) rather than a
  second supported install path. Still not independently resolved this cycle — remains the repo
  owner's call whether to delete the pnpm files or adopt pnpm properly — but flagged more pointedly
  this time since it's now been observed across multiple consecutive cycles without action.
- Local branch was seeded from `origin/main`'s tip rather than `origin/staging`'s this cycle (see
  Checks performed) — third consecutive cycle with a branch-seeding issue (07-15: seeded from
  `main`; 08-05: 76 commits stale; 08-12: seeded from `main`'s post-merge tip). Worth a look at
  whatever automation seeds these session branches.
- Re-ran `npm run lint`, `npm run typecheck`, `npm run test` (all workspaces), and
  `apps/desktop`'s `npm --workspace @bandsearch/desktop run build` after the dependency updates —
  all still green, identical pass counts to baseline: **685/686 tests** (desktop 221/222 pass + 1
  pre-existing skip, api 423/423, eval 16/16, schemas 25/25); lint and typecheck clean.
- `cargo audit`'s yanked-crate check failed with `503 Service Unavailable` through this sandbox's
  outbound proxy (unrelated to the advisory-database scan, which completed normally) — ran with
  `--no-yanked` to get a clean result; worth re-running the yanked check outside this sandbox if a
  yanked-crate concern ever comes up specifically.

---

## 2026-08-05

### Correction / backlog note — please read first

The task framing for this cycle carried forward two stale assumptions from before the session
started; both were checked directly against the GitHub API and the repo tree before anything was
touched, rather than propagated:

1. **Open-PR backlog.** Framing assumed #96 (2026-07-22) and #97 (2026-07-29) were still open —
   that part held up (verified via `list_pull_requests`, state=open): both are indeed still open
   against `staging`, alongside #98 (docs, base `main`, unrelated). But #96's mergeable state is
   now `dirty` (conflicts — `staging` has moved on to `dee443f` since #96's base `617d586`, 76
   commits behind), while #97's is `clean` (still same tip as `staging`'s current head, since no
   other maintenance PR has merged since). **Recommend closing #96 in favor of #97** (their
   contents are near-duplicate weekly-maintenance diffs, and #96 would need a manual rebase to
   even apply) **and merging #97**, then reviewing #98 separately.
2. **"No Dependabot config and no weekly-audit workflow."** This is **no longer true** — both
   `.github/dependabot.yml` (npm + cargo + uv + github-actions, all targeting `staging`) and
   `.github/workflows/weekly-audit.yml` (npm audit + pip-audit + cargo-audit, opens/updates a
   `security-audit`-labeled issue on findings) already exist on `staging`, added by the merged
   PR #92 (2026-07-08 cycle) and referenced in the 2026-06-24/07-08/07-15 log entries below. Per
   this cycle's instructions not to add Dependabot config: nothing was added — it's already
   there — but the instructions' premise ("this manual PR cycle is the entire mechanism") is
   stale and worth flagging so it isn't repeated again next week.

### Checks performed
- Verified the working branch (`claude/eloquent-volta-f8vh9h`) had zero unique commits versus
  `origin/staging` (`git log claude/eloquent-volta-f8vh9h..origin/staging` showed 76 commits
  behind; the reverse showed 0 ahead), then reset it to `origin/staging`'s tip (`dee443f`, the
  merge of #95) before starting — the branch had been seeded stale, same situation as the
  2026-07-15 cycle.
- Baseline: `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm --workspace @bandsearch/desktop run build` — all green before any changes.
- `npm outdated` / `npm audit` across all workspaces (root, `apps/desktop`, `services/api`,
  `services/eval`, `shared/schemas`).
- Confirmed root `pyproject.toml` still declares `dependencies = []` and `uv.lock` resolves only
  the `bandsearch` root package itself (`grep -c "^\[\[package\]\]" uv.lock` → 1) — nothing to
  audit on the Python side, reconfirmed rather than assumed.
- Installed `cargo-audit` (not cached in this sandbox) via `cargo install cargo-audit --locked`
  in `apps/desktop/src-tauri` and ran `cargo audit`.
- Inspected `apps/desktop/src-tauri/Cargo.lock` directly for `plist`/`quick-xml` versions before
  touching anything.
- `cargo update --dry-run` in `apps/desktop/src-tauri` for informational (non-security) Rust
  bumps.
- Attempted `cargo check` in `apps/desktop/src-tauri` (see Notes for the sandbox blocker hit).
- Checked recent CI runs on `staging`-targeting PRs via the GitHub Actions API.
- Re-ran the full baseline suite after applying updates.

### CI health (staging)
Most recent CI runs for PRs against `staging`/`main` are all `completed` / `success`, including
#97's own run (`30484908285`, 2026-07-29) and #98's (`30493384140`, 2026-07-29). No red runs
found in the recent history. GitHub's check-status API for #96 and #97's head commits currently
reports no check-run contexts registered against the *commit itself* (`pending`/`total_count: 0`
via `get_status`) — this is a quirk of how `get_status` reports GitHub Actions check-runs (as
opposed to legacy commit statuses) rather than a sign CI didn't run; the Actions run history above
confirms both PRs' CI completed successfully at the time they were opened.

### Fixes applied

- **Security fix — npm, high severity, applied.** Baseline `npm audit` found 2 high-severity
  findings:
  - `brace-expansion` `4.0.0 - 5.0.8` — DoS via unbounded expansion length / unbounded
    intermediate arrays (transitive, via `eslint` → `minimatch`).
  - `ip-address` `<=10.3.0` — leading-zero octet decoding mismatch (decimal vs. octal) and CIDR
    suffix / IPv4-mapped IPv6 misclassification, enabling SSRF / trust-boundary bypass
    (transitive, via `services/api`'s `express-rate-limit`).

  `npm audit fix` resolved both cleanly — `brace-expansion` 5.0.7 → 5.0.9, `ip-address` 10.2.0 →
  10.4.0 (via `express-rate-limit`'s own patch bump, see table below). Only `package-lock.json`
  changed; no `package.json` edits needed anywhere. `npm audit` after: **0 vulnerabilities**.

- **Rust — no security fix needed this cycle.** Inspected `Cargo.lock` before touching anything:
  `plist 1.10.0` / `quick-xml 0.41.0` are already resolved (fixed via merged #94, 2026-07-15
  cycle) — RUSTSEC-2026-0194/0195 remain fixed, confirmed not regressed. `cargo audit` found
  **0 vulnerabilities**; only informational unmaintained/unsound warnings remain (see security
  audit table below), same category as every prior cycle, no independent fix upstream.

- **Safe npm updates** — `npm update` at root picked up in-range patch/minor bumps across all
  workspaces (no `package.json` range changes required):

  | Workspace | Package | Before | After |
  |---|---|---|---|
  | root | `eslint` | 10.6.0 | 10.8.0 |
  | root | `@playwright/test` (+ `playwright`, `playwright-core`) | 1.61.1 | 1.62.1 |
  | root | `typescript-eslint` (+ `@typescript-eslint/*` sub-packages) | 8.63.0 | 8.66.0 |
  | root | `tsx` | 4.23.0 | 4.23.8 |
  | root | `globals` | 17.7.0 | 17.9.0 |
  | `apps/desktop` | `react` / `react-dom` | 19.2.7 | 19.2.8 |
  | `services/api` | `@langchain/langgraph` (+ `-sdk`, `p-queue`) | 1.4.7 | 1.4.9 |
  | `services/api` | `express-rate-limit` | 8.5.2 | 8.6.2 |
  | `services/api` | `helmet` | 8.2.0 | 8.3.0 |
  | transitive (security, see above) | `brace-expansion` | 5.0.7 | 5.0.9 |
  | transitive (security, see above) | `ip-address` | 10.2.0 | 10.4.0 |
  | transitive (various) | `@eslint/config-helpers`, `ignore` | — | patch bumps only |

  `shared/schemas` had nothing outdated within range. `services/eval` had nothing outdated.
  `apps/desktop` (beyond react/react-dom) had nothing else outdated.

  **Rust**: `cargo update --dry-run` shows ~150 lines of available non-advisory patch/minor
  bumps across the `tauri` 2.x family (`tauri 2.11.0→2.11.5`, `tauri-build`/`-codegen`/`-macros`/
  `-plugin` `2.6.0→2.6.3`, `tauri-runtime 2.11.0→2.11.3`, `tauri-runtime-wry 2.11.0→2.11.4`,
  `tauri-utils 2.9.0→2.9.3`, `wry 0.55.0→0.55.1`, `hyper 1.9.0→1.11.0`, `regex 1.12.3→1.13.1`,
  etc., plus several crate additions/removals from transitive resolution churn). None are
  security-driven, so — consistent with every prior cycle's "keep security-driven PRs minimal"
  precedent — none applied; flagged for a future dedicated Rust-refresh cycle.

### Majors — flagged, NOT applied

| Package | Current | Latest | Why held back |
|---|---|---|---|
| `typescript` (root) | 6.0.3 | 7.0.2 | Major rewrite, flagged every cycle since 07-08; needs a dedicated compatibility pass across all 4 npm workspaces + `typescript-eslint`. |
| `@types/node` (root) | 25.9.5 | 26.1.2 | Type-defs major ahead of `engines: ">=22"` / CI's pinned Node 22 — low risk but flagged per policy, unchanged from prior cycles. |
| `better-sqlite3` (`services/api`) | 12.11.1 | 13.0.3 | Native-addon major, first flagged by #96 (12.11.1 → 13.0.1) and still pending — needs its own rebuild/verification pass, not a routine bump. |

### Security audit results

| Ecosystem | Tool | Result |
|---|---|---|
| npm (all workspaces) | `npm audit` | 2 high (`brace-expansion`, `ip-address`) → **0 after `npm audit fix`** |
| Python | manual (`dependencies = []`, `uv.lock` has no third-party entries) | Nothing to audit, reconfirmed |
| Rust | `cargo audit` (0.22.2, 493 crate deps scanned) | **0 vulnerabilities**. 19 informational unmaintained/unsound warnings (GTK3 `gtk-rs` bindings, `proc-macro-error`, `unic-char-*`/`unic-common`/`unic-ucd-*`, `anyhow` `Error::downcast_mut()` unsoundness, `event-listener` `!Send` unsoundness — new this cycle, `glib` iterator unsoundness) — one more than the 18 seen in prior cycles (`event-listener` RUSTSEC-2026-0221, dated 2026-07-13); no independent fix available, same "informational only, no advisory" category as every prior cycle. |

### Rust dependency audit (informational, not applied)

`cargo update --dry-run` in `apps/desktop/src-tauri` shows dozens of available non-security
patch/minor bumps across the `tauri` 2.x crate family and its transitive dependencies (see Fixes
applied above for representative examples). None correspond to a `cargo audit` finding, so none
were applied this cycle — flagged for a future dedicated "Rust dependency refresh" cycle rather
than folded into this security-focused pass, consistent with #96/#97's precedent.

### Notes

- **Lock file drift (pre-existing, not fixed this cycle, call for repo owner)** —
  `package-lock.json` and `pnpm-lock.yaml` still coexist at the root. CI only reads
  `package-lock.json` (`npm ci`). Not independently re-measured this cycle beyond confirming both
  files still exist and diverge — per standing guidance this remains the repo owner's call, not
  an agent's, and is flagged again rather than fixed.
- **Rust build/test not verifiable in this sandbox this cycle** — `cargo check` in
  `apps/desktop/src-tauri` fails here for a reason unrelated to today's dependency changes:
  `gdk-sys`'s build script requires `gdk-3.0.pc` via pkg-config, and this sandbox has GTK3
  runtime libraries but not the `-dev`/pkg-config files (`pkg-config --exists gdk-3.0` fails).
  Attempted `apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev` to close the gap — blocked by
  404s from the Ubuntu package mirrors on several transitive packages (`libjavascriptcoregtk-4.1-dev`,
  `libwebkit2gtk-4.1-0/-dev`, `libnghttp2-dev`, `libgdk-pixbuf-2.0-dev`, etc.), same category of
  environment limitation as the 2026-07-22 cycle (mirror-blocked), not the 2026-07-29 cycle's
  (that cycle had the dev headers already present and hit the sidecar-symlink issue instead — see
  below). Also confirmed the tracked `apps/desktop/src-tauri/binaries/node-x86_64-unknown-linux-gnu`
  sidecar symlink is still broken in this sandbox (`-> /usr/bin/node`, which doesn't exist here;
  real node is at `/opt/node22/bin/node`) — but since the GTK3 pkg-config gap fails the build
  before the sidecar step is ever reached, there was nothing to gain from temporarily repointing
  it this cycle, so it was left untouched (not staged, not modified). CI has no `cargo check`/
  `cargo test` step currently (Rust coverage is `cargo-audit`-via-`weekly-audit.yml` plus
  Dependabot only) — recommend a real `cargo check`/`cargo test` pass outside this sandbox (or in
  CI, if a Rust job is ever added) before merging, same recommendation as 2026-07-22.
- Re-ran `npm run lint`, `npm run typecheck`, `npm run test` (all workspaces), and
  `apps/desktop`'s `npm --workspace @bandsearch/desktop run build` after every dependency change
  — all still green, identical pass counts to baseline: **678/678 tests** (desktop 221/222 pass +
  1 pre-existing skip, api 423/423, eval 16/16, schemas 17/17); lint and typecheck clean.

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
- Confirmed root `pyproject.toml` still declares `dependencies = []` — no Python runtime deps.
  `uv.lock` exists but only resolves the virtual root package itself (no third-party entries).
  Ran `uv export --no-hashes` → `pip-audit -r <exported requirements>` anyway for completeness:
  clean, as expected (nothing to audit). Note: running bare `pip-audit` with no scope in this
  sandbox instead audits the *ambient* system Python environment's site-packages (unrelated to
  this project) and surfaces unrelated findings (e.g. `pyjwt`, `setuptools`, `urllib3`, `wheel`)
  — those are sandbox/system noise, not project findings, and are irrelevant here.
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
| `pip-audit` | Clean — 0 vulnerabilities. No Python runtime deps declared (`dependencies = []`); `uv.lock` has no third-party entries, so there was nothing to find. |
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

# In-App Update Notification Implementation Plan (Phase 10)

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Work one phase at a time, TDD (red → green → refactor), one commit per phase.

**Goal:** Testers see a banner in the running app when a newer version is available, and on Windows/Linux can install it with one click.

**Branch:** `feature/in-app-update-notification` (base: `staging`)

**Spec:** [`docs/architecture/2026-06-03-auto-update-plan.md`](../../architecture/2026-06-03-auto-update-plan.md) — see *Deviations* below; the spec is partly stale.

---

## Starting state (verified 2026-08-30)

Phase 10 is **half-built**. The plumbing exists; nothing surfaces an update to the user.

| Already done | Where |
|---|---|
| `tauri-plugin-updater = "2"` dependency | `apps/desktop/src-tauri/Cargo.toml` |
| Plugin registered on the builder | `apps/desktop/src-tauri/src/main.rs:539` |
| `pubkey` + GitHub `latest.json` endpoint + `createUpdaterArtifacts: true` | `apps/desktop/src-tauri/tauri.conf.json` |
| `updater:default` capability | `apps/desktop/src-tauri/capabilities/default.json` |
| Release workflow with signing + draft prerelease (8 passing tests) | `.github/workflows/release.yml` |
| Updater endpoint matches the real repo (`eikrad/bandsearch-app`, public) | verified against `git remote` |

| Still missing | Consequence |
|---|---|
| Version desync: Cargo + `tauri.conf.json` say `0.2.0`, npm packages say `0.4.0-alpha.0` / `0.2.0-alpha.1` / `0.1.0` | A release cut from this tree is labelled `0.2.0`. The updater compares exactly this string. |
| No `updater().check()` call anywhere | The registered plugin is dead weight; no update is ever detected. |
| No `install_update` command | Nothing to invoke from the UI. |
| No banner, no event listener | CI already produces `latest.json` that nothing consumes. |

---

## Scope

**Does:** version consistency across the repo; startup update check; `install_update` command; a dismissible banner on Windows and Linux.

**Does not:**
- **macOS** — deferred by decision. No code signing, so the Rust updater yields no macOS entry in `latest.json`. The spec's frontend GitHub-API fallback is a second code path with its own version-compare and error handling; not worth the surface yet. macOS testers get no banner for now.
- **Signing-key generation and the `v0.4.0` tag** — manual steps, out of scope.

---

## Decisions

| Question | Decision |
|---|---|
| macOS path | Defer. Windows/Linux only. |
| "Later" button | Dismisses **per version**, persisted in `localStorage` (same idiom as `bandsearch_onboarding_complete`). Next version shows the banner again. |
| Version number | `0.4.0` everywhere — **one version for the whole monorepo**, including `shared/schemas` and `services/eval`. |
| Banner placement | `position: fixed`, top, overlaying — visible on every screen regardless of route. |

## Deviations from the 2026-06-03 spec

Conventions in `AGENTS.md` and the existing code win over the spec, which predates the strict-TypeScript/React state of the app.

| Spec says | We do | Why |
|---|---|---|
| `document.createElement` + `innerHTML` blob | React component in `src/ui/` | Every other view is `React.createElement` with an inline `palette`. `innerHTML` appears nowhere else. |
| German UI strings ("Jetzt installieren", "Später") | English | The whole UI is English — `WelcomeView`, `SettingsView`, all of it. |
| "`release.yml` (neu)" | Already exists, tested | Built in Phase 7. |
| Add `allow-install-update` to capabilities | Not needed | `updater:default` is already present, and the four existing app commands (`save_brave_api_key`, `save_turso_config`, `save_api_endpoint_url`, `complete_onboarding`) are not listed individually either. Follow the existing pattern. |

---

## Global constraints

- Base the PR on `staging`, never `main` (`AGENTS.md`).
- TypeScript only, `strict` + `noImplicitAny`. No new `.js`/`.mjs`. No durable `any`.
- NodeNext: local imports carry `.js` extensions in TypeScript source.
- TDD: failing test first, then the minimum code to pass, then refactor.
- `npm test` green before every commit.
- Test at seams through public interfaces — pure decision modules with injected side effects, mirroring [`firstRunOnboarding.ts`](../../../apps/desktop/src/firstRunOnboarding.ts).
- Mark completed items `✓ Done` in `docs/ROADMAP.md`.

---

## File map

| Path | Responsibility | New? |
|---|---|---|
| `apps/desktop/src/updateNotification.ts` | Pure decision: should the banner show, given payload + dismissal state | new |
| `apps/desktop/src/ui/UpdateBanner.ts` | The banner view | new |
| `apps/desktop/src/ui/viewTypes.ts` | `UpdateBannerHandlers` | edit |
| `apps/desktop/src/startDesktopBrowserApp.ts` | Listen for `update-available`, wire decision → banner → `install_update` | edit |
| `apps/desktop/src/ui/mountDesktopReactApp.ts` | Render the banner above the routed view | edit |
| `apps/desktop/src-tauri/src/main.rs` | Startup check, `update-available` event, `install_update` command | edit |
| `apps/desktop/src-tauri/Cargo.toml`, `tauri.conf.json` | Version `0.4.0` | edit |
| `package.json`, `apps/desktop/`, `services/api/`, `services/eval/`, `shared/schemas/` | Version `0.4.0` | edit |

---

## Phases

### Phase 1: One version across the whole repo 🟡

- [ ] **Red** — `apps/desktop/test/app-version.test.ts`: the version in `Cargo.toml`, `tauri.conf.json` and every workspace `package.json` is the same string. Fails today (`0.2.0` vs `0.4.0-alpha.0` vs `0.2.0-alpha.1` vs `0.1.0`).
- [ ] **Green** — set all seven to `0.4.0`.
- [ ] `npm test` green.
- [ ] **Commit** — `chore: sync the app version across npm, Cargo and Tauri`

Not a tautology: it cross-checks independent files that must agree because the updater compares `tauri.conf.json`'s version against `latest.json`. It would have caught the bug that exists right now.

**Files:** `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/tauri.conf.json`, `package.json`, `apps/desktop/package.json`, `services/api/package.json`, `services/eval/package.json`, `shared/schemas/package.json`, `apps/desktop/test/app-version.test.ts`

---

### Phase 2: Decide when a banner is shown 🟢

- [ ] **Red** — `apps/desktop/test/update-notification.test.ts`, at the seam:
  - shows the banner for a newer version that was never dismissed
  - stays hidden for a version the user already dismissed
  - shows again for a *different* version after an earlier dismissal
  - stays hidden when no update was reported
- [ ] **Green** — `apps/desktop/src/updateNotification.ts`: pure decision + a dismissal store against injected storage. No DOM, no Tauri, no `fetch`.
- [ ] **Commit** — `feat(desktop): decide when an update banner is shown`

**Depends on:** nothing. Isolated.

---

### Phase 3: Background check and install command 🔴

- [ ] **Red** — Rust test in `main.rs`'s existing `#[cfg(test)]` module asserting the config/command surface.
- [ ] **Green** — in `main.rs`:
  - `use tauri::Emitter`
  - spawn the updater check in the `.setup()` hook, after `app.manage(...)`; on a hit emit `update-available` with `{ version, canAutoInstall }` (`canAutoInstall = cfg!(not(target_os = "macos"))`)
  - `install_update` command: check, then `download_and_install`
  - register `install_update` in `generate_handler![...]`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` green; `npm test` green.
- [ ] **Commit** — `feat(desktop): check for updates on startup and expose install_update` (🔴 → commit body: why event-driven over polling, what stays unverified)

**Depends on:** Phase 1 — the version is what the updater compares.

**Known gap, accepted:** `cargo test` proves it compiles and the command is registered. That the updater actually reaches GitHub, finds a release and emits the event needs a real signed release — a manual step held out of scope. Keep the untestable surface thin and say so in the commit body.

---

### Phase 4: The banner 🟡

- [ ] **Red** — `apps/desktop/test/update-banner.test.ts`: renders the version; shows an Install button when `canAutoInstall`; calls the dismiss handler on "Later".
- [ ] **Green** — `apps/desktop/src/ui/UpdateBanner.ts` (`React.createElement`, existing `palette`, English strings, `position: fixed` + high `z-index`); `UpdateBannerHandlers` added to `viewTypes.ts`.
- [ ] **Commit** — `feat(desktop): add the update notification banner`

**Depends on:** nothing at runtime; slots into Phase 5.

🟡 because `viewTypes.ts` is shared by every view.

---

### Phase 5: Wire it through the app 🔴

- [ ] **Red** — extend `apps/desktop/test/start-desktop-browser-app.test.ts` with an injected event listener: an `update-available` payload makes the banner appear; "Later" persists and it does not reappear on the next start; "Install" invokes `install_update`.
- [ ] **Green** — `startDesktopBrowserApp.ts` subscribes (injectable, so tests need no Tauri) and feeds the Phase 2 decision; `mountDesktopReactApp.ts` renders the banner above the routed view.
- [ ] `npm test` + `npm run typecheck` + `npm run lint` green.
- [ ] **Commit** — `feat(desktop): show the update banner when a new version is available` (🔴 → commit body)

**Depends on:** Phases 2, 3, 4.

---

### Phase 6: Docs 🟢

- [ ] `docs/ROADMAP.md` — tick the Phase 10 boxes that are now true, and correct the entry: the plugin/pubkey/workflow items were already done before this cycle.
- [ ] `docs/architecture/2026-06-03-auto-update-plan.md` — record the deviations above and the macOS deferral, so the doc stops describing an implementation that was never built this way.
- [ ] `README.md` — how updates reach testers, and that macOS is not covered.
- [ ] **Commit** — `docs: record the in-app update notification behaviour`

---

## Remaining manual steps (not in this plan)

1. `npx tauri signer generate -w ~/.tauri/bandsearch.key` → public key into `tauri.conf.json`, private key + password into GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. *(A pubkey is already committed — confirm the matching private key is in the repo secrets before tagging, or regenerate both.)*
2. Push tag `v0.4.0` → three CI jobs → draft prerelease with `.msi`, `.deb`/`.AppImage`, `.dmg` and `latest.json`.
3. Verify end to end: run a `0.3.x` build against the `v0.4.0` release, confirm the banner appears and Install completes.

## Follow-ups this cycle deliberately leaves open

- macOS update path (GitHub-API check + download link banner).
- Issue #133 — `foreign_keys` pragma inconsistent across SQLite connections.
- Architecture entry 9 — `services/api` CommonJS → ESM.

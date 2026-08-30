# Phase 7 — Android

Outcome of a design session on 2026-08-30. Records what was decided, what is
forced by the platform, and what the roadmap got wrong. Not yet implemented.

The roadmap's Android entry was three lines: `tauri android init`, voice input
via the Web Speech API, and a "responsive layout review". Two of those three
turned out to rest on false premises, and the third is much larger than it
sounds.

## Why Tauri, still

The PWA was considered as an alternative and rejected — but only *after* the
distribution and voice decisions below, which require an APK and a native
plugin respectively. A PWA can do neither. Tauri is the consistent answer here,
not the leftover one: desktop already ships on it, with one frontend, one Rust
backend and one release workflow.

## Forced by the platform (not decisions)

1. **No Node sidecar on Android.** Tauri's shell plugin on mobile is
   [restricted to opening URLs](https://v2.tauri.app/plugin/shell/) — no child
   processes, no executing binaries. Android also forbids executing binaries
   from app-writable storage. `better-sqlite3` is out for the same reason.
   → Android is remote-API-only. `reconcile_sidecar()` already has that branch;
   Android simply always takes it.

2. **`tauri-plugin-updater` does not support Android.** The official setup
   registers it under `#[cfg(desktop)]`. The update banner from Phase 10 will
   never appear on Android. Our `let Ok(updater) = … else` already fails soft.

3. **The Web Speech API does not work in Android WebView.** The roadmap claimed
   it "works natively in Chromium-based Android webviews — no native plugin
   needed". It does not: the object exists but no callbacks fire
   ([Chromium 487255](https://issues.chromium.org/issues/40417848), open since
   2015). It works in Chrome *on* Android, which is not what Tauri embeds.

## Decisions

### API endpoint — compiled-in default, overridable

The Android build ships the production URL as its default; the existing
Settings field from Phase 9.4 stays, so anyone can point the app at their own
instance. Rationale: the project is Apache-2.0 and self-hosting should work.

Implementation note: the default must be **platform-conditional**. Today
`should_run_local_sidecar()` returns true for an empty endpoint, so an
un-configured Android build would try to start a sidecar that cannot exist. On
Android, Rust returns the production URL as the default and never takes the
sidecar branch; the frontend already reads the endpoint from
`gemini_config_status.apiEndpointUrl` and follows automatically.

### Voice — native microphone button with a settings toggle

A Kotlin Tauri plugin wrapping Android's `SpeechRecognizer`, a microphone
button in the composer, and a Settings switch that hides it and never requests
`RECORD_AUDIO`.

Noted for context: Android's soft keyboard (Gboard, Samsung) already offers
voice typing into the chat `<input>` with zero code. That covers dictation, but
it cannot be toggled by the app — the keyboard belongs to the user — which is
why the toggle requirement implies the native button.

### Distribution — own F-Droid repository

APKs built and signed in CI, index published (GitHub Pages is enough), testers
add the repo once via QR. The F-Droid client then handles update notifications
and installs.

This is what closes the updater gap: **Android needs no update code of its
own.** Official F-Droid inclusion was considered and rejected for now — it
requires reproducible builds, which
[F-Droid documents as hard for Rust/NDK](https://f-droid.org/docs/Reproducible_Builds/),
plus a metadata recipe, review, and a `NonFreeNet` anti-feature label because of
Gemini and Brave.

### Card actions — stars replace "Rate", rating implies saving

See the updated `docs/design/UI_GUIDELINES.md`. This changes the **desktop**
card too, not only mobile.

## Defects found while planning

Each is independent of Android and worth fixing on its own; see the linked
issues.

| Defect | Where | Issue |
|---|---|---|
| `···` button does nothing | `mountDesktopReactApp.ts:235` | #151 — live on desktop today |
| Save/Rate hidden on mobile | `chatRenderAdapter.ts:22-23` | #152 — violates a spec written 15 min earlier |
| "Rate" always writes 5 | `mountDesktopReactApp.ts:233` | #153 |
| Touch targets ~32px | `ChatAppView.ts:112-118` | #154 |
| `getAuthStatus` fails open | `authApiClient.ts:65-70` | #155 — a 502 during cold start reads as "auth disabled" |

The first three share one root cause: a test named
`"collapses secondary actions on mobile"` encoded the spec violation as the
expected behaviour, so the divergence was defended rather than caught. The rules
added to `AGENTS.md` address that directly.

## Work items

- #156 — seven views with no mobile handling (largest item)
- #157 — native microphone button + settings toggle
- #158 — own F-Droid repository
- #159 — platform-conditional endpoint default

## Open — not yet decided

- **Offline behaviour.** Android has no local fallback at all. Phase 5.5 built
  local-first for the desktop; Android discards it. What the app should show
  with no connection is undecided.
- **Hosting.** Android is hard-dependent on a reachable API, so this gates it.
  Render Free costs nothing but takes 30–60s to wake; Fly.io offers
  scale-to-zero at ~300ms–2s for roughly $0.15/month idle. Measured: the API
  uses **61 MB RSS** idle, so the 256MB class is enough — the earlier 512MB
  figure was a guess and was wrong. Deferred pending Phase 9.5, which has never
  been verified on any platform.
- **Android CI**: signing keys, `minSdkVersion`, NDK in the release workflow.

## Sequencing

Phase 9.5 (verify Render + Turso end-to-end) blocks the useful part of Android,
since the app cannot work without a reachable API. Do that first, or at least in
parallel — but do not treat Android as done until it has run against a real
deployment.

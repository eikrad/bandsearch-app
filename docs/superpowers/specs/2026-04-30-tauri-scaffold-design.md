# Tauri Scaffold Design

**Date:** 2026-04-30
**Status:** Approved

## Problem

The Bandsearch desktop package has a complete React UI and a solid Express API, but no native desktop wrapper. Users must run the API manually and open a browser — there is no distributable app.

## Decisions

| Topic | Decision | Rationale |
|-------|----------|-----------|
| API integration | Sidecar — Tauri spawns the Node.js process | Self-contained UX; no manual API startup |
| Platforms | macOS + Linux | Realistic for alpha; Windows unblocked but untested |
| Native features | Window + native menu bar (About, Quit) | Minimal viable native feel |
| Sidecar lifecycle | Start with app, stop with app | YAGNI — crash recovery deferred to post-alpha |

## Architecture

```
apps/desktop/
├── src/                          ← existing React UI (unchanged)
├── src-tauri/
│   ├── src/main.rs               ← window, menu, sidecar lifecycle
│   ├── build.rs                  ← tauri-build call
│   ├── Cargo.toml
│   ├── tauri.conf.json           ← app metadata, window, sidecar declaration
│   └── capabilities/default.json ← shell execute permission
└── package.json                  ← @tauri-apps/cli added, build scripts
```

## Sidecar Strategy

Tauri v2 sidecar requires the binary to live in `src-tauri/binaries/` with a target-triple suffix. Bundling a full Node.js binary is a post-alpha concern. In this scaffold:

- **Development & alpha:** `std::process::Command::new("node")` spawns the system Node.js. Path to `services/api/src/server.js` is resolved relative to the workspace root.
- `main.rs` holds a `ChildHandle` in the app state; `on_window_event(CloseRequested)` kills it.
- API port: `3001` (existing default; overridable via `PORT` env var).

## Native Menu

Tauri v2 `MenuBuilder` + `PredefinedMenuItem::quit` + custom `About` item.
macOS: App menu. Linux: top-level menu bar.

## TDD Phases

| Phase | Deliverable | Test |
|-------|-------------|------|
| 1 | Tauri window opens | `cargo build` succeeds; manual `tauri dev` smoke test |
| 2 | Native menu (About + Quit) | Unit test for `build_menu` label extraction |
| 3 | Sidecar lifecycle | Unit test for `api_spawn_args` pure function |
| 4 | ROADMAP updated | — |

Each phase ends with a git commit.

## Out of Scope (post-alpha)

- Bundled Node.js binary (true sidecar packaging)
- Crash recovery / restart logic
- System tray
- Auto-updater
- Windows support

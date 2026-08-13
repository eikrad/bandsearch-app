# Complete TypeScript migration design

## Summary

Finish the Bandsearch JS→TS migration: convert every remaining JavaScript/MJS file to real TypeScript, then enable `strict: true` and `noImplicitAny: true` across the monorepo. Work proceeds in phases with hard verification gates so the module graph, tooling chain, and runtime behaviour stay coherent.

As of the design date, all `src/` application code is already TypeScript (~95 `.ts` files). Remaining JS is almost entirely tests plus a few tooling/config files (~82 `.js`/`.mjs` files).

---

## Goals

- No `.js` / `.mjs` source in the repo except generated artefacts and `node_modules` / build outputs.
- Real TypeScript: ESM imports, meaningful types, no standing `any` debt.
- Compiler: `strict: true`, `noImplicitAny: true`; remove `allowJs` / `checkJs` when migration is complete.
- Existing behaviour preserved unless a Strict find surfaces a real bug (then fix + test, called out in the commit).
- Docs updated: `AGENTS.md` TypeScript policy, Roadmap parallel track, README as needed.
- Root scripts no longer reference stale `.js` entrypoints (e.g. `server.js`).

## Non-goals

- New product features.
- Rust (Tauri) or Python changes.
- Unrelated dependency upgrades (except what tooling requires to load TS configs).

---

## Scope

| Area | Action |
|---|---|
| `apps/desktop/test/**/*.js` | → `.ts` with real types |
| `services/api/test/**/*.js` | → `.ts` with real types |
| `shared/schemas/test/**/*.js` | → `.ts` with real types |
| `tests/e2e/**/*.js` | → `.ts` |
| `playwright.config.js` | → `.ts` |
| `apps/desktop/scripts/build.js` | → `.ts` |
| `eslint.config.mjs` | → `.ts` with a documented, working ESLint loader |
| Existing `src/**/*.ts` | Fix only as needed for Strict / import coherence |
| `tsconfig*` / package scripts / CI | Align with Strict and TS-only tree |
| `AGENTS.md`, `docs/ROADMAP.md`, README | Reflect completed migration |

---

## Approach

Phased migration (not big-bang). Strict is a dedicated late phase so rename/typing work stays reviewable and tests stay green between phases.

Optional **architecture deepening** is allowed when migration friction reveals shallow modules, leaky seams, or domain mismatches — see Architecture refactors below.

---

## Phases and verification gates

No phase advances while its gates are red.

### Phase 0 — Baseline

- Branch from `staging`.
- Record green baseline.

**Gates:** `npm test`, `npm run typecheck`, `npm run lint`.

### Phase 1 — Tooling

- `apps/desktop/scripts/build.js` → `.ts`; update npm scripts (`tsx` or equivalent).
- `playwright.config.js` → `.ts`.
- `eslint.config.mjs` → `.ts` with loader that ESLint actually executes.
- Fix any package.json / workspace script references.

**Gates:** `npm run lint`; desktop `build`; Playwright config loads (`playwright test --list` or equivalent).

### Phase 2 — Desktop tests

- Convert all `apps/desktop/test/*.js` → `.ts`.
- `require` → `import` / `import type`.
- Type fakes/helpers against real module interfaces.

**Gates:** `npm test --workspace @bandsearch/desktop`; desktop `typecheck`.

### Phase 3 — API and shared tests

- Convert `services/api/test/**/*.js` and `shared/schemas/test/**/*.js` → `.ts`.
- Prefer adding types at the source under `src/` when tests need them.

**Gates:** API and shared workspace `test` + `typecheck`.

### Phase 4 — E2E

- Convert `tests/e2e/*` → `.ts`.

**Gates:** `npx playwright test --list`; optional smoke if env/keys allow.

### Phase 5 — Strict

- Enable `strict: true` and `noImplicitAny: true` in all package tsconfigs.
- Fix `src/` and tests for Strict.
- Remove `allowJs` / `checkJs`.
- Prefer `unknown` + narrowing (and existing Zod schemas) at external/JSON boundaries.

**Gates:** full `npm run typecheck`; full `npm test`.

### Phase 6 — Cleanup

- Remove leftover `.js` references and stale root `server.js` script paths.
- Update `AGENTS.md` (retire incremental-migration policy), Roadmap parallel track (`✓ Done`), README.
- Confirm no remaining source `.js`/`.mjs` via `find` (excluding `node_modules` / build / `.git`).

**Gates:** `npm run ci`; empty JS/MJS inventory for source/config; optional local smoke (`npm run dev`, desktop build).

---

## Typing strategy

- Node test runner unchanged: `node:test` + `node:assert/strict` via `tsx --test`.
- Module system: ESM + `NodeNext` (including required `.js` extensions in TypeScript import paths where NodeNext demands them).
- No durable `as any` / `any`; temporary casts during a port must be gone before the phase ends.
- Test doubles implement the same types as production seams.
- Strict fixes change types and narrowing, not behaviour — unless a real bug is proven, then fix with a test and label the commit as a bugfix.

---

## Architecture refactors (optional, gated)

Triggered only when migration or Strict work exposes real friction:

- Shallow modules (interface nearly as complex as implementation).
- Leaky seams or hard-to-type boundaries.
- Domain terms in `CONTEXT.md` that do not match the code.

Rules:

1. Refactor must materially help migration, typing, testability, or locality — not opportunistic cleanup.
2. Brief note to the user; get a go unless the change is trivial and local.
3. Own commit (or clear sub-step) with the same verification gates as the surrounding phase.
4. If a candidate contradicts an ADR, call that out and agree before changing it.
5. Use domain vocabulary from `CONTEXT.md` and deep-module language (module / interface / seam / adapter) when proposing deepenings.
6. No new product features disguised as refactors.

---

## Coherence guarantees

Behavioural continuity is enforced by gates, not assumed from “it typechecks”:

| Risk | Mitigation |
|---|---|
| Broken module graph after `require` → `import` | Per-phase workspace tests |
| NodeNext import path / extension drift | `typecheck` + tests each phase |
| Tooling cannot load TS configs/scripts | Explicit lint / build / Playwright list gates |
| Strict changes runtime assumptions | Same tests green before and after; bug fixes explicit |
| Monster unreviewable diff | Phased PRs targeting `staging` |

---

## PR / git workflow

- Base branch: `staging` (never `main` directly).
- Prefer one PR per phase (or small phase groups) for reviewability.
- Conventional commits (`chore`, `refactor`, `fix`, `test`, `docs`).
- `npm test` green before each commit (repo policy).

---

## Definition of done

1. No project-owned `.js` / `.mjs` sources remain.
2. All tsconfigs use `strict` + `noImplicitAny`; no `allowJs`/`checkJs`.
3. `npm run ci` green.
4. Docs (`AGENTS.md`, Roadmap, README) describe TypeScript as the only JS-toolchain language for app/test/config code.
5. Optional architecture deepenings from this effort are either done with gates or explicitly deferred with a note.

# Bandsearch Roadmap

## How to read this document

**Phase numbers are history, not order.** They record when something was
written down, not when it is due. Phases 8, 9 and 10 all carry open items
simultaneously, and Phase 10 was built while Phase 9.5 — which blocks more than
anything else here — had never been run.

A phase number is an **identity** ("which body of work is this"), not a
position in a queue. The two were previously conflated into one number, which
is why the document misled. They are now written separately: the queue below
says what to do, the numbered sections say what it belongs to.

## Work queue — in order

Revisit this list whenever something lands or a new blocker appears; it is a
plan, not a second permanent structure. Every open item links its issue; an
issue without a place here is listed under 8.

*Reordered 2026-10-05:* the Scaleway migration (#237) and the eval rebuild
behind it took the lead; Phase 10's release turned out done (v0.4.1); the card
action work is down to #154; search quality (#257), the desktop's Render
default (#238) and the privacy items before real users had no place in the
queue and now do.

1. ~~**#155 — `getAuthStatus` fails open.**~~ ✓ Done (#161).
2. **#237 in production, together with Phase 9.5 (#144).** Merge the Scaleway
   default (#256) into `staging`; set `SCW_SECRET_KEY` on Render (a key of its
   own); merge `staging` → `main`; then run the 9.5 checklist on Render. That
   verifies Render + Turso — never done, the old bottleneck — and Scaleway in
   production in one pass. Rollback: `LLM_PROVIDER=gemini` on Render.
   Done so far, all on `staging`:
   - ✓ Golden-run history + dashboard, model id in provenance (#242, #209, #134)
   - ✓ Planner/reflection failures degrade instead of 502 (#247, #241)
   - ✓ Scaleway behind `LLM_PROVIDER`, role-based model config, live judge and
     calibration on Scaleway (#249, #204 part 1)
   - ✓ Stable measurement: replay, Last.fm tags, repeats with paired statistics
     (#252, #250)
   - ✓ Constraint queries checked deterministically against MusicBrainz (#254, #253)
   - ✓ Model comparison: judge `glm-5.2`, research `deepseek-v4-flash-0731`, on
     par with Gemini, ~11 s slower per query (#255, #204 part 2, ADR 0004)
   - ✓ Scaleway is the default provider; desktop key vendor-neutral, privacy
     policy and UI name Scaleway (#256). Before this reaches `main`, set
     `SCW_SECRET_KEY` on Render; rollback is `LLM_PROVIDER=gemini` there
3. **#257 — improve search quality, one measured change at a time.** Evidence
   quality of the why texts (the judge's weakest dimension, ~0.5), then hard
   constraints, then reflection (#180, never runs today). Each change measured
   with 3 judged golden runs against the deepseek baseline.
4. **Remove Gemini (last step of #237)** once Scaleway has run stably on Render
   for a few days. Small; can slot in between #257 changes.
5. **#238 — desktop defaults to the Render deployment**, local sidecar as an
   explicit choice. Needs 9.5 passed.
6. **Privacy before real users:** #132 (telemetry opt-out, Art. 21), #135
   (operator becomes controller), #136 (Art. 4 AI-literacy note, DPIA
   screening). Then #248 (judge scores on live searches), which needs #132.
7. **Phase 11 — Android.** #159 (endpoint default, shares the default with
   #238), then #156 (the seven views, the largest item), #157, #158. #259 (spoken
   replies) is an undecided idea after #157.
8. **Whenever there is room:**
   - #251 judge as a quality gate — after #257's reflection work
   - #154 card action touch targets (the one card-action item left)
   - Phase 8 F6/F7/F8: #140, #142, #143
   - Architecture 9, ESM migration: #146
   - Phase 10 macOS update check: #145
   - #245 release re-runs that skip build and publish
   - 9.6 CI/CD deploy gate (no issue yet; optional)
   - Tech debt: #133, #168, #171, #172, #173, #174, #205
   - Once there is real traffic: #239 (PPI), #240 (input drift)

~~4. The card action work — #151–#154 and #163–#167.~~ Moved: done in #192
except #154, which is now under 8.
~~5. Phase 10 — signing key, then the first `v0.4.0` release.~~ Done: v0.4.1
was built, signed and published by the release pipeline on 2026-10-05 (after a
failed upload and a manual rebuild, see #245). Only the macOS check (#145) is
left, under 8.

The constraints this order satisfies:

```
#237 Scaleway default ─┐
                       ├─→ main + SCW_SECRET_KEY on Render ─→ 9.5 verified (#144)
9.5  Render + Turso ───┘        ├─→ #238 desktop defaults to Render
                                ├─→ Phase 11 Android (cannot work without a reachable API)
                                ├─→ 9.6 CI/CD deploy gate (optional)
                                └─→ #248 live judge scores (also needs #132)

#257 search quality ─→ reflection (#180) ─→ #251 judge gate
#237 stable on Render for a few days ─→ remove Gemini

Independent, can start any time:
 · #154 · #145 · #146 · #140/#142/#143 · #245 · tech debt
```

When an entry moves, say so in place rather than deleting it — an entry that
turned out to sit in the wrong phase is itself worth recording.

## The numbered record

Everything below is the history: what was built, what was decided, and where
earlier entries turned out to be wrong. The numbers identify the work; they do
not order it. For order, use the queue above.

## Completed (Phase 0-5)

- Monorepo foundation, CI baseline, Apache-2.0 licensing.
- Recommendation core with MusicBrainz + LangChain + Gemini.
- Explainable responses (`why`, `sourceTags`, `sourceSignals`).
- API hardening: structured errors, rate limits, timeout/retry, request logging.
- Desktop chat UI foundation: recommendation cards, mode switching, save/rate actions, feedback states.
- Preference memory: save bands, ratings, categories, notes.
- Search modes: `fresh` and `preference-aware` (preference context wired through to Gemini prompt).
- Persistence abstraction: `PreferenceRepository` interface with in-memory and Postgres implementations. (Postgres removed later — see Architecture entry 8.)
- Database-backed preferences (Postgres/Supabase) with migration script. (Postgres removed later — see Architecture entry 8.)
- E2E smoke tests covering the full preference-aware recommendation chain.
- Tauri desktop scaffold: native window, menu bar (About + Quit), API sidecar lifecycle (macOS + Linux).
- Playwright browser smoke tests: verify the built app actually renders in a real browser. ✓ Done.
- Compact card layout with `GenreChips`, `···` more button, and `PlatformLinks` action pills. ✓ Done.
- Saved Artists page: hash-based client-side routing (`#/`, `#/saved`), MusicBrainz artist search, directional selection (selected artists injected as priority preference context). ✓ Done.
- Artist pictures: Wikidata SPARQL with Last.fm fallback, lazy-loaded with graceful degradation. ✓ Done.
- Music platform links: deep search links for Bandcamp, SoundCloud, Spotify on every artist card. ✓ Done.
- Full chat interface: scrollable `MessageThread` with user bubbles, **assistant prose** (`assistantReply`), and recommendation cards; conversation history forwarded to Gemini via LangChain. ✓ Done.
- Session persistence: SQLite `chat_sessions`/`chat_messages` tables with in-memory fallback; session CRUD routes; `POST /recommendations` accepts `messages` array. ✓ Done.

## Phase 3.5 — UX Fundamentals

- Settings screen with API key management: enter, validate, and save the Gemini API key through the desktop UI (`#/settings`), persisted under the OS config directory as `bandsearch/config.json`, with the API sidecar restarted after save; in-browser dev falls back to localStorage. ✓ Done
- First-run onboarding: show a welcome screen on first launch that guides the user through API key entry. ✓ Done
- Error UX: human-readable error messages when the API key is missing or invalid, when a rate limit is reached, or when Gemini is unreachable — instead of a silent failure (settings screen shows a banner when no key is stored). ✓ Done
- **Brave web research pipeline** (optional): `RECOMMENDATION_PIPELINE=research` + `BRAVE_API_KEY` — Gemini plans Brave searches, extracts niche candidates from web snippets, verifies with MusicBrainz `lookupArtist`, one reflection round within a Brave call budget, LangGraph orchestration, evidence URLs in ranked `why`; falls back to classic pipeline when Brave key is missing. ✓ Done

## Phase 4 — Prompt safety & injection guardrails ✓ Done

- Bracket-marker envelope pattern wraps all untrusted text (query, chat history, preference context, Brave search fields) before Gemini calls. ✓ Done
- Length caps enforced at the HTTP boundary (`validateRecommendationHttpBody`): 2 000-char query, 4 000-char per message, 50 messages, 2 000-char priorityContext (silently truncated + logged). ✓ Done
- ADR 0001 documents the three-layer defence, residual risks, and what was intentionally not built. ✓ Done
- **Classic pipeline removed**; research pipeline (Brave + LangGraph + MusicBrainz) is the only recommendation path. `BRAVE_API_KEY` is now required at boot — no silent fallback. Deprecated `GET /search/artists` route removed. ✓ Done

## Phase 4.5 — Data Portability, Sharing & Saved Artists Organisation ✓ Done

- Export / import saved artists as JSON for backup and device transfer. ✓ Done
- Shareable recommendations: copy-to-clipboard for a formatted recommendation list (artist + why-text). ✓ Done
- **Artist grouping**: group saved artists by genre (fetched from MusicBrainz) or by user-defined custom tags/criteria, with the ability to create, rename, and delete groups and drag artists between them. ✓ Done

## Phase 5.5 — Cross-device Sync (Turso) ✓ Done

- Sync preference data via Turso/libSQL between desktop and phone. Turso is SQLite-compatible with a remote replica: the desktop writes locally (offline-capable) and syncs automatically to the cloud. A future mobile app or web client reads from the same remote database.
- Minimal invasive: new `TursoPreferenceRepository` adapter for libSQL, activated via `PREFERENCE_STORE=turso`. Connection string and auth token configurable through the settings UI (Phase 3.5). ✓ Done
- Foundation for Phase 6 multi-user: Turso supports per-user namespacing and row-level security.

Implemented: `POST /preferences/turso/test` connection probe; Turso URL + token configurable in Settings with save-and-test flow; Tauri backend persists credentials and restarts the API with `PREFERENCE_STORE=turso`; `PREFERENCE_STORE=turso` activates `TursoPreferenceRepository` (fully implemented including groups/export).

**Correction — the offline half was claimed but not built.** The first bullet promises that "the desktop writes locally (offline-capable) and syncs automatically to the cloud". `PREFERENCE_STORE=turso` never did that: it creates a plain remote `@libsql/client`, so every single statement is a network round trip and the app is unusable without a connection. The entry read `✓ Done` for months while half of it did not exist.

**Now delivered as `PREFERENCE_STORE=turso-sync`.** A local replica holds the full database; reads and writes hit the local file and are exchanged with Turso Cloud via `push()`/`pull()`. A failed exchange is logged, not thrown — the write is already durable locally and goes out on the next attempt, which is the whole point of local-first. Writes push immediately; a 60s timer pulls and pushes; startup syncs once before serving so a restart never answers from a stale replica.

- `turso-sync` is a **separate store value**, not a flag on `turso`. An existing `PREFERENCE_STORE=turso` deployment (including Render, see `render.yaml`) keeps behaving exactly as before.
- Config: `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` as usual, plus `TURSO_SYNC_PATH` for the replica file (default `bandsearch-sync.db`).
- One client serves preferences, users and sessions. A second would mean a second replica file and a second sync loop racing the first, so `createTursoSyncRepositories()` builds all three from one.
- `createPreferenceRepository()` refuses `turso-sync` rather than falling back to SQLite: opening a replica is asynchronous, and silently handing back a different database is the failure mode this entry is correcting.

**Two things to know about this choice.**

1. **`@tursodatabase/sync` is pre-1.0** (0.7.2, with 0.8.0-pre in flight), adopted deliberately. Turso's own docs point offline-write workloads here rather than at `@libsql/client`'s embedded-replica `offline` option, so this is the forward path — but it has not reached 1.0 and Turso recommends keeping independent backups. The dependency is confined to `turso/tursoSyncClient.ts`; everything above it talks to the `TursoClient` interface, which the remote client satisfies too. Swapping back is a one-line change in `server.ts`.
2. **The package is ESM-only and this workspace compiles to CommonJS.** Its dependency `@tursodatabase/serverless` declares only an `import` condition, and tsx's CJS resolver fails on it with `ERR_PACKAGE_PATH_NOT_EXPORTED` — in tests and in production alike, since `npm start` is `tsx src/server.ts`. tsx 4.23.12 is the latest release, so there is no upgrade. `tursoSyncClient.ts` works around it with a `new Function("s", "return import(s)")` escape hatch, which stays a real dynamic `import()` that esbuild will not rewrite into a `require`. **The proper fix is to make `services/api` an ES module** — see Architecture entry 9.

No native binary is published for `darwin-x64`; Apple Silicon, Linux (x64/arm64) and Windows x64 are covered. The release workflow already ships an ARM-only macOS sidecar, so this costs nothing today.

## Phase 6 — Auth and Multi-user ✓ Done

- Multi-user support: auth/session layer and user-scoped preference ownership. ✓ Done
- User-linked preference schema evolution (`user_id`) and repository updates. ✓ Done
- API auth middleware and route protection for preference endpoints. ✓ Done
- Basic onboarding/login UX flow in the desktop client. ✓ Done

Implemented: bcrypt (10 rounds) + JWT (30-day) auth. Single-user bypass: 0 users → pass-through, 1 user → auto-attach, ≥2 users → 401. Recovery codes (20 random bytes hex). `InMemoryUserRepository`, `SqliteUserRepository`, `TursoUserRepository`. `POST /auth/register`, `POST /auth/login`, `POST /auth/reset-password`, `GET /auth/status`. Desktop auth gate in `startDesktopBrowserApp.ts`: checks `/auth/status` on startup, redirects to `#/register` (0 users) or `#/login` (users exist, no token). `LoginView`, `RegisterView`, `ResetPasswordView` using React.createElement. Token stored via `authTokenStore.ts` (localStorage); injected as `Authorization: Bearer` header by `chatClient.ts`. All source files converted to TypeScript; no `any` types remain in touched files.

## Phase 7 — Platform Expansion ✓ Done

**Android was moved out of this phase on 2026-08-30 — see Phase 11.** It was
bundled here because Windows and Android are both "a new platform", but the two
never shared a dependency shape: Windows was self-contained and shipped, while
Android cannot run the Node sidecar and therefore depends on a hosted API
(Phase 9.5). Grouping by topic rather than by dependency is what put it in the
wrong place, and the mistake only became visible once the sidecar limitation was
found. With Android extracted, the remaining work in this phase is complete.

- Windows: Tauri already produces a Windows installer via `tauri build`; the main work is sidecar binary naming (`node-x86_64-pc-windows-msvc.exe` in `tauri.conf.json`) and adding a Windows runner to CI. ✓ Done: `externalBin: ["binaries/node"]` added to `tauri.conf.json`; `sidecar_name()` uses `env!("TARGET")` so the binary name always matches the compile-time Rust target triple; `windows-latest` runner added to CI matrix with `fail-fast: false` and `shell: bash`.
- Windows release pipeline: add a CI job (`release.yml`) that runs on `windows-latest`, downloads the official Node.js binary for `x86_64-pc-windows-msvc`, renames it to `node-x86_64-pc-windows-msvc.exe`, places it in `src-tauri/binaries/`, then runs `tauri build` to produce the `.msi` / `.exe` installer. Same job needed for `ubuntu-latest` (`node-x86_64-unknown-linux-gnu`) and `macos-latest` (`node-aarch64-apple-darwin` + `node-x86_64-apple-darwin` for universal binary). Artifacts should be uploaded per-platform and attached to a GitHub Release on version tags. ✓ Done: `.github/workflows/release.yml` builds on `ubuntu-latest` / `windows-latest` / `macos-latest` (ARM sidecar), signs updater artifacts via `TAURI_SIGNING_*` secrets, and attaches a draft prerelease with `tauri-action`. macOS Intel sidecar deferred.
- Android: **moved to Phase 11** on 2026-08-30 (dependency on 9.5, see the note above).

## Parallel Track — TypeScript Migration ✓ Done

- Goal: improve refactor safety and reduce runtime contract drift across the monorepo.
- ✓ Done: `shared/schemas/src/contracts.ts`; API recommendation stack (`recommendations.ts`, `recommendationPipeline.ts`, `recommendationAgent.ts`); HTTP helpers (`http/errors.ts`, `http/artistSearchHandler.ts`) and `registerBandsearchRoutes.ts`.
- ✓ Done: first-run welcome route (`#/welcome`), `WelcomeView`, `firstRunOnboarding.ts` gate + persistence (`complete_onboarding` / `onboarding_completed` in Tauri config; `bandsearch_onboarding_complete` in browser dev).
- ✓ Done: chat recommendation failures map API error codes to readable banners via `apiErrorMessages.ts` (`rate_limit_exceeded`, pipeline init, MusicBrainz context, Gemini unavailable, connectivity).
- ✓ Done: all application, test, and config sources converted to TypeScript; `eslint-disable @typescript-eslint/no-explicit-any` removed; row types, input types, and API response interfaces replace all `any` in repository and integration layers.
- ✓ Done: **Strict mode across the monorepo.** `apps/desktop`, `services/api`, and `shared/schemas` compile under `strict: true` + `noImplicitAny: true` with `allowJs`/`checkJs` removed; no project-owned `.js`/`.mjs` sources remain; root scripts and ESLint target TypeScript only.

## Phase 8 — Eval & Quality Observability

**Spec:** [`docs/architecture/2026-05-29-eval-architecture.md`](architecture/2026-05-29-eval-architecture.md)

Three-layer system to measure recommendation quality over time: automatic obscurity scoring, LLM-as-judge evaluation, and minimal user feedback — all surfaced in a developer dashboard with baseline comparison so prompt changes and model updates have visible before/after impact.

**Implementation steps (in order, each independently deployable):**

- [x] Step 1: `recommendation_events` logging — persist every recommendation request with query, obscurity target, verified count, reflection status, `pipeline_diagnostics_json`, and pipeline versioning (`pipeline_version`, prompt hashes, model IDs) ✓ Done
- [x] Step 2: Last.fm obscurity scoring — async worker enriches events with `listeners` count and tier (`cult` / `underground` / `obscure`) per band after the response is sent ✓ Done
- [x] Step 3: Obscurity target setting — three-button UI (`Cult Following` / `Underground` / `Truly Obscure`), `obscurityTarget` field threaded through request body → planner prompt → event log ✓ Done
- [x] Step 4: Search source quality + deterministic evidence checks — URL heuristic for discovery sources plus `citation_support_rate` and `generic_why_flag` per band; stored per event, no LLM needed ✓ Done
- [x] Step 5: LLM-as-judge worker — async judge scoring each band on relevance, obscurity fit, evidence quality, and discovery value; never on the request path ✓ Done. Provider history: designed for Claude, built on Mistral (`MISTRAL_API_KEY`; until 2026-08-31 the key was wrongly posted to Anthropic), **moved to Scaleway on 2026-10-05** (`SCW_SECRET_KEY`, `SCW_JUDGE_MODEL`, ADR 0004, #237).
- [x] Step 5b: Judge calibration — ~20–30 hand-labeled recommendations + ~15–20 GroUSE-style unit tests; compute judge–human agreement rate before trusting Layer 2 dashboard deltas ✓ Done. Ran for the first time on 2026-10-05, against the production judge on Scaleway: 97.3% agreement (`services/eval/history/judge-runs.jsonl`); before, `run-calibration.ts` called Anthropic and never ran (#204).
- [x] Step 6: Baseline snapshots — `eval_baselines` table + `POST /eval/baseline` endpoint; named snapshots of aggregated metrics before experiments; filterable by `pipeline_version` ✓ Done
- [x] Step 7: Developer dashboard — `GET /eval/dashboard` serving a standalone HTML+Chart.js page with overview panel (current vs. baseline delta), pipeline funnel panel, human–LLM alignment metrics, trend charts, obscurity distribution, and event log; guarded by `EVAL_DASHBOARD_ENABLED=true` ✓ Done
- [x] Step 8: User feedback button — single batch-level reaction bar after recommendations render (`Spot on` / `Too mainstream` / `Wrong direction`); disappears after 12 s or next user input ✓ Done
- [x] Step 9: Golden dataset — `services/eval/golden-set.json` with 10 curated queries including sonic-property `nuggets` and `antiBands`; `run-golden.ts` computing `antiBandRate@8` (CI fail if > 50%; `--strict` for zero-tolerance) and `nuggetCoverage@8` against MusicBrainz tags/genres (fail below per-entry `minNuggetCoverage`) ✓ Done. **Corrected 2026-09-16:** (1) removed `precision@8`, which duplicated `nuggetCoverage@8` under a misnomer; (2) rewired `nuggets` from band names → sonic properties scored against MB tags — the band-name version was exact-match recall, which the design explicitly rejected. No `expectedBands` field; see `docs/architecture/2026-05-29-eval-architecture.md`
- [x] Step 9b: Persist golden-run snapshots — `run-golden.ts` used to print PASS/FAIL and exit; there was no history of `nuggetCoverage@8` / `antiBandRate@8` to compare before/after prompt or pipeline changes. Live eval had `eval_baselines` + dashboard deltas; golden regression needed the same idea (JSON report and/or store + diff against previous run). See #209. ✓ Done (2026-10-05): every run is recorded in `services/eval/history/golden-runs.jsonl` with the API-reported model, per-query latency and top 8; `npm run dashboard -w services/eval` writes a self-contained comparison page (sign test, top-8 overlap vs. the noise floor of repeat runs). Prerequisite for the Scaleway migration (#237).

**Future (after data exists) — blocked by Phase 9.5:** the data this depends on only
accumulates once the eval layer runs against a real deployment.

- `search_quality_check` node in LangGraph loop: if search source quality is low, planner receives feedback and regenerates queries before extraction — only worth building once dashboard data confirms the correlation

**Polish — deferred from the 2026-06-01 implementation review** (see `docs/architecture/2026-05-30-phase8-implementation-plan.md`, findings F1–F8; F1–F5 already fixed):
- [ ] F6 (#140) — Reconcile the plan's stale Design Decision #2: `evalWorker.processEvent` is invoked from `routes/registerBandsearchRoutes.ts`, not `recommendationPipeline.ts`. Docs-only; update the architecture spec so it matches the code.
- [ ] F7 (#142) — Event table stores no `recommendations_json`, prompt hashes, model ids, or `user_id`, so the dashboard cannot link to the full recommendation payload and baselines cannot be filtered by prompt hash / model. Add at least `recommendations_json` + `user_id` to `recommendation_events`; treat prompt-hash filtering as a separate later step. (`eval/evalRepository.ts`)
- [ ] F8 (#143) — Tune evidence heuristics: `GENERIC_PHRASES` flags common comparison phrasing ("fans of", "similar to", "in the vein of") that also appears in good why-text → noisy `generic_why_flag`; and `citationSupportRate` defaults to 1.0 when a why has no URLs, inflating evidence metrics. Only flag generic phrasing when it co-occurs with zero citations; distinguish "no URLs" from "all URLs supported". Validate against the calibration set before locking in. (`eval/evidenceChecker.ts`)

---

## Phase 9 — Cloud Deployment (Render + Turso)

Deploy the Express API to Render so the desktop app can connect to a public endpoint instead of requiring a local sidecar. Consolidate on Turso/libSQL as the sole database backend for production (local `better-sqlite3` remains for offline/dev).

Independent of Phase 8 — eval instrumentation can run against a local API first; cloud deployment unlocks shared hosting and cross-device access without a running desktop sidecar.

### 9.1 — Turso chat session repository ✓ Done

**Files:** `services/api/src/sessions/chatSessionRepository.ts`

The chat session repository currently has only SQLite (`better-sqlite3`) and in-memory implementations. Preferences and users already have Turso adapters, but sessions do not — this is the last piece blocking a fully Turso-backed deployment.

**Action:**
1. Create `services/api/src/sessions/tursoChatSessionRepository.ts` implementing the same interface as the existing SQLite variant, using `@libsql/client`. ✓ Done
2. Wire it into the factory in `chatSessionRepository.ts` so that `PREFERENCE_STORE=turso` (or a dedicated `SESSION_STORE` env var) selects the Turso adapter. ✓ Done (wired in `app.ts`)
3. Add unit tests mirroring the existing SQLite session tests. ✓ Done (`test/turso-chat-session-repository.test.js`)

---

### 9.2 — Turso migration script ✓ Done

**Files:** `services/api/scripts/migrate.ts`

The existing migration script targets local SQLite and Postgres (Postgres since removed — see Architecture entry 8). It needs to also handle Turso so that the `chat_sessions`, `chat_messages`, `saved_bands`, `artist_groups`, and `artist_group_members` tables are created on the remote Turso database.

**Action:**
1. Extend `migrate.js` (or create a parallel `migrate-turso.js`) to run `CREATE TABLE IF NOT EXISTS` statements against a Turso URL using `@libsql/client`. ✓ Done (`migrate.ts` handles `PREFERENCE_STORE=turso`)
2. Include all tables from preferences, auth, and sessions. ✓ Done (`migrations/002_full_schema.sql`)
3. Document the migration command in the README: `TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run migrate:turso`. ✓ Done

---

### 9.3 — Render Web Service deployment ✓ Done

Deploy the Express API as a Render Web Service.

**Action:**
1. Add a `render.yaml` to the repo root declaring the web service: `type: web`, build command `npm install`, start command `npm start` (run at the repo root — the root `package.json` scripts delegate to the API workspace), health check path `/`, and `region: frankfurt`. ✓ Done
2. Configure required environment variables in `render.yaml` (non-secret keys) and via the Render dashboard (secrets): `GEMINI_API_KEY`, `BRAVE_API_KEY`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `JWT_SECRET`, `PREFERENCE_STORE=turso`. Render injects `PORT` automatically. ✓ Done
3. Verify the `start` script in `services/api/package.json` works — it already uses `tsx`; confirm the installed Node.js version on Render matches local (specify `engines.node` in `package.json` if needed). ✓ Done (`"start": "tsx src/server.ts"` added; `engines.node: ">=22"` added to root `package.json`; `tsx` moved to `services/api` production deps)
4. Connect the GitHub repository to Render; auto-deploy triggers on push to `main`. — manual step via Render dashboard

---

### 9.4 — Desktop app: configurable API endpoint ✓ Done

**Files:** `apps/desktop/src/`, `apps/desktop/src-tauri/`

The desktop app currently assumes the API runs as a local Tauri sidecar on `localhost`. For a cloud deployment, users need to be able to point the app at a remote API URL.

**Action:**
1. Add an API endpoint field to the Settings screen (`#/settings`) — default to local sidecar, allow overriding with a remote URL (e.g. `https://bandsearch-api.onrender.com`). ✓ Done (`ApiEndpointCard` in `SettingsView.ts`). *(This example read `bandsearch.onrender.com` — a host that doesn't exist — until 2026-09-28; the same wrong host sat in the Settings placeholder and tests, fixed in #224.)*
2. Persist the setting in the OS config directory alongside the existing Gemini/Turso credentials. ✓ Done (`api_endpoint_url` in `bandsearch/config.json`; localStorage fallback for browser dev)
3. When a remote endpoint is configured, skip launching the local API sidecar in the Tauri backend. ✓ Done (single `reconcile_sidecar()` invariant: local sidecar runs iff no remote endpoint)
4. Update `chatClient.ts` and all API callers to use the configured endpoint. ✓ Done (`startDesktopBrowserApp` resolves the endpoint before building the auth/chat clients; `chatClient` already took `apiBaseUrl`, so no change needed there)

Implemented: `save_api_endpoint_url` Tauri command + `apiEndpointUrl` on `gemini_config_status`; controller `saveApiEndpointUrl` with http(s) format validation (no reachability probe — Render cold starts would make one falsely fail); settings card with "Reset to local"; Gemini/Brave/Turso cards stay visible in remote mode with a "managed locally" note. Note: applies on next app restart (the frontend resolves the base URL at startup).

---

### 9.5 — End-to-end verification (#144)

*2026-10-05:* scheduled together with the Scaleway default reaching `main` (work queue item 2), so the run verifies Scaleway in production too.

**Action:**
1. Create a Turso database and run the migration script against it.
2. Deploy the API to Render with `PREFERENCE_STORE=turso`.
3. Verify from the desktop app: register a user, log in, get recommendations, save artists, create groups, chat sessions persist across restarts.
4. Verify cold-start latency on the Render free tier is acceptable (free tier spins down after 15 min inactivity; first request takes 30–60 s — upgrade to Starter $7/month for always-on if needed).
5. Document free-tier limitations (cold starts, no SLA) in the README.

---

### 9.6 — CI/CD pipeline (optional, no issue yet)

Render auto-deploys on every push to the connected branch, so no separate deploy workflow is needed. The optional hardening step is a pre-deploy gate.

**Action:**
1. Add a GitHub Actions workflow (`.github/workflows/deploy-render.yml`) that runs `npm run ci` on push to `main` and, only if tests pass, triggers a Render deploy hook (`curl -X POST $RENDER_DEPLOY_HOOK_URL`).
2. Store the Render deploy hook URL as a GitHub Actions secret (`RENDER_DEPLOY_HOOK_URL`) — available in the Render service dashboard under Settings → Deploy Hook.
3. Optionally disable Render's automatic git-push deploys and rely solely on the Actions-triggered hook so broken code never reaches production.

---

## Phase 10 — In-App Update-Notification

**Spec:** [`docs/architecture/2026-06-03-auto-update-plan.md`](architecture/2026-06-03-auto-update-plan.md)

Tester werden direkt in der App über neue Versionen informiert. Windows & Linux: vollautomatischer Ein-Klick-Update via `tauri-plugin-updater`. macOS: kein Update-Pfad in diesem Zyklus (siehe Deviations im Plan) — ohne Code-Signing liefert der Rust-Updater keinen macOS-Eintrag in `latest.json`, daher kein Banner für macOS-Tester vorerst.

- [x] `tauri-plugin-updater` einbinden — bereits vor diesem Zyklus erledigt (Dependency, Plugin-Registrierung, `pubkey` + Endpoint in `tauri.conf.json`); Version auf `0.4.0` synchronisiert (dieser Zyklus, `apps/desktop/test/app-version.test.ts`) ✓ Done
- [x] Hintergrund-Check beim App-Start (Rust → Tauri-Event, event-getrieben, ein Check pro Start statt Polling) ✓ Done
- [x] `install_update` Tauri-Command (Windows & Linux) ✓ Done
- [ ] macOS: Frontend-seitiger GitHub-API-Check (#145) — bewusst zurückgestellt (zweiter Code-Pfad mit eigenem Versionsvergleich/Error-Handling, noch nicht die Fläche wert)
- [x] Einheitlicher Update-Banner im Frontend — als React-Komponente (`UpdateBanner.ts`) statt „kein neues File": das restliche UI ist durchgehend `React.createElement` mit eigenem File pro View, `innerHTML` kommt sonst nirgends vor ✓ Done
- [x] GitHub Actions Release-Workflow für Linux, Windows & macOS (Node-Sidecar-Download, `tauri-action`) — bereits vor diesem Zyklus erledigt (Phase 7, `.github/workflows/release.yml`) ✓ Done
- [x] Signing-Key generieren + GitHub Secrets konfigurieren — manueller Schritt ✓ Done (the v0.4.1 artifacts are signed)
- [x] Erstes versioniertes Release ✓ Done: **v0.4.1**, published 2026-10-05 by the release pipeline. The first attempt's Linux upload failed and the full re-run skipped build and publish (#245); a manual build of the tag completed it. *Originally planned as `v0.4.0`; the entry read:* Setzt den Signing-Key voraus; erster echter Beweis, dass der Updater funktioniert.

---

## Phase 11 — Android

**Spec:** [`docs/superpowers/plans/2026-08-30-android.md`](superpowers/plans/2026-08-30-android.md)

**Moved here from Phase 7 on 2026-08-30.** It sat under "Platform Expansion"
next to Windows on the assumption that Android would be self-contained like the
desktop — its own sidecar, no cloud dependency. That assumption is false:
Tauri's shell plugin cannot spawn processes on mobile, so Android is
remote-API-only and **blocked by Phase 9.5**.

Two claims in the old Phase 7 entry were also wrong and are corrected in the
plan: the Web Speech API does *not* work in Android WebView (the object exists,
no callbacks fire — [Chromium 487255](https://issues.chromium.org/issues/40417848)),
and "responsive layout review" understated the work — only `ChatAppView` has any
mobile handling, the other seven views have none.

- [ ] #159 — platform-conditional API endpoint default (compiled-in production
      URL, Settings override kept so self-hosting works). Confirmed
      2026-09-28: the production URL is `https://bandsearch-api.onrender.com`
      (not `bandsearch.onrender.com`, which the Settings placeholder, several
      tests and this doc's Phase 9.4 example used until #224).
- [ ] #156 — mobile layout for the seven views that have none; largest item.
      Navigation decided: bottom tab bar (Chat/Saved/Settings only, back-arrow
      on edge screens), Settings stays single-scroll, Saved Artists' style-
      reference selection bar moves to the bottom — see the spec and
      `docs/design/UI_GUIDELINES.md`'s Mobile Navigation section.
- [ ] #157 — microphone button + Settings toggle. **Engine changed 2026-10-06:**
      `whisper-large-v3` on Scaleway, reached through a new endpoint on our API,
      instead of Android's `SpeechRecognizer` (which sends audio to Google on
      most phones — the reason this was put back in the queue). Dictation only;
      off by default with a notice that the recording goes to our server and
      Scaleway (France); no auto-submit; inline hint on permission denial or a
      failed transcription. Needs a size/duration cap and rate limit on the new
      endpoint, and a spike on how to record in Tauri's Android WebView — see
      the spec and `docs/design/UI_GUIDELINES.md`'s Voice Input section.
- [ ] #259 — spoken replies (text-to-speech). Idea only, not scoped: Scaleway
      has no TTS model, Android's local `TextToSpeech` is the likely route, and
      reading result cards aloud would sound bad, so a short spoken summary is
      the realistic shape. Not before #157 has shipped.
- [ ] #158 — own F-Droid repository; this also closes the update path, since
      `tauri-plugin-updater` does not support Android. Release mechanics
      decided: rides the same release-please pipeline and tag as desktop,
      `versionCode` is Tauri's default (derived from semver), F-Droid metadata reused from
      README.md/CHANGELOG.md — see the spec and `docs/releasing.md`.
- [ ] Android CI: `minSdkVersion` 29, single production keystore in GitHub
      Actions secrets, pinned NDK version in the release workflow

Resolved 2026-09-28 (grilling session, see the spec): offline behaviour uses
the existing paths only (`ConnectingView` at launch, the chat error banner
mid-session) — no cache, no dedicated screen — but both texts were written
for the desktop sidecar and need Android-appropriate copy, part of #156.
Hosting is Render Free, accepting the 30–60s cold-start
over Fly.io's ~$0.15/month scale-to-zero. Measured while planning: the API
idles at 61 MB RSS, so a 256MB instance suffices either way.

---

## Deferred / Under Review

- PWA client on shared API (#147).
- Optional Spotify import with explicit user consent (#148).
- Billing and subscription controls (#149).
- ~~Optional migration to Vertex AI governance mode.~~ Dropped 2026-10-05 (#150 closed): Gemini is being removed (#237), so there is nothing left to govern.

## Architecture — Pending Deepening

The following refactors were identified during architecture review but not yet implemented. Each has a clear action and known files.

### 1. Extract auto-group inference out of the route handler ✓ Done

Resolved — the inference logic now lives in `services/api/src/preferences/bandGroupInference.ts`, with its own tests in `services/api/test/band-group-inference.test.js`. `POST /preferences/groups/auto` in `registerBandsearchRoutes.ts` just calls into it.

---

### 2. Split the monolithic preference repository interface ✓ Done

Done in `f7171fc`: `BandRepository` and `BandGroupRepository` are declared in `preferenceRepository.ts`, with `assertMethods` validating each set separately.

**Resolved**, though not the way the action below proposed — see the note at the end.

- `buildContext` / `buildContextForIds` are gone from all four adapters. They were eight copies of one rule that differed only in how they filtered, and the rule decides what the LLM sees rather than how bands are stored. They are now one `buildSavedBandContext(source, { ids, userId })` in `services/api/src/savedBandContext.ts`, next to the recommendation pipeline. `savedBandContextFormat.ts` folded into it. `BandRepository` is down from six methods to four.
- Consumers now take only the half they use: `splitPreferenceRepository()` returns `{ bands, groups }` as two narrow views on one backend. The routes take `resolvedBandRepository` and `resolvedBandGroupRepository` separately, and the recommendation pipeline is handed the band half — its type asks for nothing but `listSavedBands`.

Two behaviour changes worth knowing: SQLite no longer filters selected ids with a SQL `IN` clause but in memory, like the other three adapters already did; and an empty `selectedArtistIds` array is now explicitly a filter matching nothing rather than falling through to "every band", which the callers already assumed.

**Why the adapters were not split into separate files.** The entry justifies itself with "adding any method means touching four files", but splitting each adapter into a band module and a group module does not change that — it makes eight files, and a new band method still touches four of them. Each adapter talks to one database and legitimately implements both halves. What actually shrank the surface was deleting the two context methods from all four. `PreferenceRepository = BandRepository & BandGroupRepository` therefore stays, no longer as a "backwards compatibility during transition" placeholder but as the documented answer to "what one storage backend provides"; the separation that pays off is on the consuming side, and that is what `splitPreferenceRepository` gives.


**Files:** `services/api/src/preferences/` — the repository files (`sqlitePreferenceRepository.ts`, `tursoPreferenceRepository.ts`, `postgresPreferenceRepository.ts` — since removed, see entry 8 — and `preferenceMemory.ts`) plus the factory `preferenceRepository.ts`

All four implementations carry 13 methods covering three distinct concerns: band CRUD (4), context building for the recommendation pipeline (2), and group management (5 + import + status). Adding any method means touching four files.

**Action (original, superseded):** Split into two interfaces: `BandRepository` (CRUD + context building) and `BandGroupRepository` (group operations + import). Each adapter implements only its relevant interface. The factory selects both implementations for the active store. The context-building methods (`buildContext`, `buildContextForIds`) move closer to the recommendation pipeline, where the LLM prompt format is the real concern.

---

### 3. Consolidate the HTTP retry seam shared by integration clients ✓ Done

Resolved — `fetchWithTimeoutAndRetry` now lives in `services/api/src/integrations/httpClient.ts`, imported by both `musicbrainz.ts` and `braveSearch.ts`, with its own test in `services/api/test/http-client.test.js`.

---

### 4. Remove duplicated user repository helpers ✓ Done

Resolved in `2c7c7a1` — `normalizeEmail()`, `publicUser()` and `rowToUser()` live in `services/api/src/auth/userModel.ts`; both adapters import them; covered by `services/api/test/user-model.test.ts`.

<details><summary>Original entry</summary>


**Files:** `services/api/src/auth/userRepository.ts`, `tursoUserRepository.ts`

`normalizeEmail()`, `publicUser()`, and `rowToUser()` are copied verbatim in both user repository adapters.

**Action:** Move the three functions into a shared `services/api/src/auth/userModel.ts` module. Both adapters import from it. The factory in `userRepository.ts` is unchanged. Test `normalizeEmail` once in `userModel.test.ts`.

</details>

---

### 5. Consolidate duplicate `gemini_config_status` reads in the desktop settings controller ✓ Done

Resolved in `9bc4058` — `readStatus()` in `geminiDesktopSettings.ts` is the single read; `getBootstrapGate` and `getSettingsViewProps` both call it, and `gemini-desktop-settings.test.ts` asserts one `invokeTauri` call per invocation of each.

---

### 6. Bearer token forwarded to user-configured remote endpoints

**Files:** `apps/desktop/src/startDesktopBrowserApp.ts`, `apps/desktop/src/authAwareFetch.ts`

`authAwareFetch` injects `Authorization: Bearer <token>` on every request. Once a user overrides the API endpoint in Settings, all requests — including auth API calls — go to the user-supplied URL carrying the JWT. In a self-hosted scenario with a trusted operator-supplied URL this is correct behaviour; if the URL were somehow corrupted (e.g. a stored config tampered on disk) the token could be sent to an unintended host.

**Note (low priority, no immediate action):** The desktop is a local trust boundary, so this risk is low. Document the invariant in `authAwareFetch.ts`: tokens are sent to `apiBaseUrl` only, and `apiBaseUrl` originates from either the default localhost or the URL the user explicitly saved in Settings. Revisit if the app ever accepts the endpoint from a non-user source (e.g. a deep-link or QR code).

---

### 7. Saved artists: one screen served by two competing implementations ✓ Done

Resolved — `createSavedArtistsShell` is the sole owner. `savedArtistsModel.ts` and its 199 lines of tests are gone, along with the `getSavedArtistsViewPropsImpl` seam and the app's view-flag state. Net −422/+28 in the deletion commit.

**Correction to this entry's original premise.** It claimed the shell was "the path the running app uses" and the model the second path. It was the other way round, and both were broken:

- The chat header's "Saved" button called `shell.navigate("saved-artists")`, which set a **view flag on the app and never touched the router**. The hash stayed `#/`, so the mount fell through to its default branch and served the screen from `savedArtistsModel` — rendered with the *chat* handler object, which has no `onExport`, `onImportFile`, `onCreateGroup`, `onDeleteGroup` or `onAutoGroup`. The view invokes those with `?.`, so Export, Import, "Group by genre" and Create silently did nothing, and the model's `groups` array was never written — the group list was permanently empty.
- The `#/saved` route did reach the shell, but the shell returned `{savedArtists, groups, selectedIds, …}` where the view renders `header`, `artists`, `selectedCount`. It **threw** `TypeError: Cannot read properties of undefined (reading 'title')` on every visit. Reachable only by typing the hash or reloading on it, which is why nobody reported it.
- `savedHandlers.onActivateStyleRef` was `async () => {}`, so "Use as style reference" worked only on the model path.

The suite was green throughout: `routed-mount.test.ts` asserted only `element.type.name` without ever rendering, and `saved-artists-view.test.ts` fed the view a hand-written prop object. No test paired a real supplier with the real view — the same failure mode this entry already documented for the five deleted methods, one level up.

**What changed.** `SavedArtistsViewProps` is now declared in `ui/viewTypes.ts` and owned by the view, so every supplier must satisfy a type none of them owns. The Saved button navigates the router, so `#/saved` is the only way in. Selection lives on the app (`toggleArtistSelection` / new `clearArtistSelection`), which is where `requestRecommendations` already read it from. `test/saved-artists-screen.test.ts` drives the real shell through the real view, and separately drives the mount's handler object, so both the prop-shape drift and the missing-handler wiring now have a test that fails when they regress.

**Not covered:** `onExport` needs `Blob` / `URL.createObjectURL` / `document`, so it is exercised only through `exportArtists` on the shell, not through the mount handler.

---

### 8. Postgres adapter has no user scoping ✓ Done — adapter removed

**Files:** `services/api/src/preferences/postgresPreferenceRepository.ts`

Found while working on entry 2. `PREFERENCE_STORE=postgres` selects an adapter that ignores users entirely: `listSavedBands()` takes no `userId` and queries `SELECT * FROM saved_bands` with no `WHERE user_id`, and `addSavedBand` never writes a `user_id` column. The routes do pass `req.userId` — the argument is silently dropped. SQLite and Turso both scope correctly, so Phase 6's user-scoped ownership simply does not hold on this backend: every user reads and can delete every other user's saved bands.

Not reachable in the current deployment — `render.yaml` sets `PREFERENCE_STORE=turso`, and Phase 9 consolidates production on Turso — but the adapter ships and is one env var away.

**Action:** Decide between fixing and removing. Fixing means threading `user_id` through the schema and every query, matching `sqlitePreferenceRepository.ts`, plus a migration for existing rows; it needs a real Postgres instance to verify, which the unit suite does not have. Removing deletes a backend nothing uses and takes the "four adapters" count down to three. Removal is the better trade unless Postgres is a deployment target someone actually wants.

**Resolved by removal.** Phase 9 consolidates production on Turso, nothing deployed selects Postgres, and a backend without data isolation is risk without benefit. Gone: `postgresPreferenceRepository.ts` and its tests, the `pg` dependency and `@types/pg`, `migrations/001_create_saved_bands.sql` (Postgres-only DDL), `migratePostgres()` in `scripts/migrate.ts`, and `DATABASE_URL` / `DATABASE_SSL` from the runtime config. Three adapters remain: SQLite, Turso, in-memory.

`PREFERENCE_STORE=postgres` now **fails at boot** rather than falling through to the SQLite default — a silent database swap on an existing deployment would be worse than a refused start. The guard sits in both `validateRuntimeEnv` and `createPreferenceRepository`, since `createApp` can be handed a runtime config directly. `npm run migrate` likewise refuses when `DATABASE_URL` is set instead of running the wrong migration.

---

### 9. `services/api` is CommonJS in an increasingly ESM ecosystem (#146)

*(Was marked "← next up" until 2026-08-30. It is independent and blocks nothing, whereas 9.5 blocks Android, the deploy gate and the eval data — so it is not the next thing. Kept as a ready-to-start item.)*

**Files:** `services/api/package.json`, `services/api/tsconfig.json`, and every `.ts` file under `services/api/src`

Adding `@tursodatabase/sync` (Phase 5.5) surfaced this: the package is ESM-only, its dependency `@tursodatabase/serverless` publishes only an `import` condition, and tsx's CJS resolver rejects it with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Node 26 itself can `require()` it — this is tsx's resolver hook, and 4.23.12 is the newest release, so waiting for a fix is not a plan.

`turso/tursoSyncClient.ts` currently works around it with a `new Function("s", "return import(s)")` escape hatch. That is contained and commented, but it is a workaround, and the next ESM-only dependency will need its own.

**Action:** Set `"type": "module"` on `services/api`, move the tsconfig to an ESM module target, and fix the fallout — `__dirname` / `__filename` (used in `scripts/migrate.ts` and several tests), `require()` interop, and any `import.meta` restrictions that flip the other way. `apps/desktop` has the same shape and would follow separately. Worth pairing with a check of whether tsx is still needed at runtime, or whether a build step would serve the API better in production.

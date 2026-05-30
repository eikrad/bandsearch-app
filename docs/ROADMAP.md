# Bandsearch Roadmap

## Completed (Phase 0-5)

- Monorepo foundation, CI baseline, Apache-2.0 licensing.
- Recommendation core with MusicBrainz + LangChain + Gemini.
- Explainable responses (`why`, `sourceTags`, `sourceSignals`).
- API hardening: structured errors, rate limits, timeout/retry, request logging.
- Desktop chat UI foundation: recommendation cards, mode switching, save/rate actions, feedback states.
- Preference memory: save bands, ratings, categories, notes.
- Search modes: `fresh` and `preference-aware` (preference context wired through to Gemini prompt).
- Persistence abstraction: `PreferenceRepository` interface with in-memory and Postgres implementations.
- Database-backed preferences (Postgres/Supabase) with migration script.
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

## Phase 6 — Auth and Multi-user ✓ Done

- Multi-user support: auth/session layer and user-scoped preference ownership. ✓ Done
- User-linked preference schema evolution (`user_id`) and repository updates. ✓ Done
- API auth middleware and route protection for preference endpoints. ✓ Done
- Basic onboarding/login UX flow in the desktop client. ✓ Done

Implemented: bcrypt (10 rounds) + JWT (30-day) auth. Single-user bypass: 0 users → pass-through, 1 user → auto-attach, ≥2 users → 401. Recovery codes (20 random bytes hex). `InMemoryUserRepository`, `SqliteUserRepository`, `TursoUserRepository`. `POST /auth/register`, `POST /auth/login`, `POST /auth/reset-password`, `GET /auth/status`. Desktop auth gate in `startDesktopBrowserApp.ts`: checks `/auth/status` on startup, redirects to `#/register` (0 users) or `#/login` (users exist, no token). `LoginView`, `RegisterView`, `ResetPasswordView` using React.createElement. Token stored via `authTokenStore.ts` (localStorage); injected as `Authorization: Bearer` header by `chatClient.ts`. All source files converted to TypeScript; no `any` types remain in touched files.

## Phase 7 — Platform Expansion

- Windows: Tauri already produces a Windows installer via `tauri build`; the main work is sidecar binary naming (`node-x86_64-pc-windows-msvc.exe` in `tauri.conf.json`) and adding a Windows runner to CI. ✓ Done: `externalBin: ["binaries/node"]` added to `tauri.conf.json`; `sidecar_name()` uses `env!("TARGET")` so the binary name always matches the compile-time Rust target triple; `windows-latest` runner added to CI matrix with `fail-fast: false` and `shell: bash`.
- Windows release pipeline: add a CI job (`release.yml`) that runs on `windows-latest`, downloads the official Node.js binary for `x86_64-pc-windows-msvc`, renames it to `node-x86_64-pc-windows-msvc.exe`, places it in `src-tauri/binaries/`, then runs `tauri build` to produce the `.msi` / `.exe` installer. Same job needed for `ubuntu-latest` (`node-x86_64-unknown-linux-gnu`) and `macos-latest` (`node-aarch64-apple-darwin` + `node-x86_64-apple-darwin` for universal binary). Artifacts should be uploaded per-platform and attached to a GitHub Release on version tags.
- Android: use Tauri's Android target (`tauri android init`). Voice input as the primary chat input method via the Web Speech API (`SpeechRecognition`), which works natively in Chromium-based Android webviews — no native plugin needed. Requires responsive layout review and touch-friendly tap targets throughout the UI.

## Parallel Track — Incremental TypeScript Migration (Non-blocking)

- Goal: improve refactor safety and reduce runtime contract drift while continuing feature delivery.
- Rule: no big-bang rewrite; convert touched files/modules incrementally during normal work.
- Start with high-risk boundaries first: recommendation pipeline, API route contracts, desktop chat/render adapters.
- Enable gradual typing with mixed JS/TS support (`allowJs` + `checkJs`) and migrate modules to `.ts` as they stabilize.
- ✓ Done: `shared/schemas/src/contracts.ts`; API recommendation stack (`recommendations.ts`, `recommendationPipeline.ts`, `recommendationAgent.ts`); HTTP helpers (`http/errors.ts`, `http/artistSearchHandler.ts`) and `registerBandsearchRoutes.ts`. `npm run dev` / `@bandsearch/api` tests run via **tsx** so TypeScript loads next to remaining JavaScript.
- ✓ Done: first-run welcome route (`#/welcome`), `WelcomeView`, `firstRunOnboarding.ts` gate + persistence (`complete_onboarding` / `onboarding_completed` in Tauri config; `bandsearch_onboarding_complete` in browser dev); desktop tests run with **tsx**.
- ✓ Done: chat recommendation failures map API error codes to readable banners via `apiErrorMessages.ts` (`rate_limit_exceeded`, pipeline init, MusicBrainz context, Gemini unavailable, connectivity).
- ✓ Done: all source files from Phase 6 and earlier converted to TypeScript; `eslint-disable @typescript-eslint/no-explicit-any` removed from all 11 batch-converted files; row types, input types, and API response interfaces replace all `any` in repository and integration layers.
- Keep this track side-by-side with product phases; do not block UX/features on migration tasks.

## Phase 8 — Eval & Quality Observability

**Spec:** [`docs/architecture/2026-05-29-eval-architecture.md`](architecture/2026-05-29-eval-architecture.md)

Three-layer system to measure recommendation quality over time: automatic obscurity scoring, LLM-as-judge evaluation, and minimal user feedback — all surfaced in a developer dashboard with baseline comparison so prompt changes and model updates have visible before/after impact.

**Implementation steps (in order, each independently deployable):**

- [x] Step 1: `recommendation_events` logging — persist every recommendation request with query, obscurity target, verified count, reflection status, `pipeline_diagnostics_json`, and pipeline versioning (`pipeline_version`, prompt hashes, model IDs) ✓ Done
- [x] Step 2: Last.fm obscurity scoring — async worker enriches events with `listeners` count and tier (`cult` / `underground` / `obscure`) per band after the response is sent ✓ Done
- [x] Step 3: Obscurity target setting — three-button UI (`Cult Following` / `Underground` / `Truly Obscure`), `obscurityTarget` field threaded through request body → planner prompt → event log ✓ Done
- [ ] Step 4: Search source quality + deterministic evidence checks — URL heuristic for discovery sources plus `citation_support_rate` and `generic_why_flag` per band; stored per event, no LLM needed
- [ ] Step 5: LLM-as-judge worker — async Claude judge scoring each band on relevance, obscurity fit, evidence quality, and discovery value; activated by `ANTHROPIC_API_KEY`; silently skipped if absent
- [ ] Step 5b: Judge calibration — ~20–30 hand-labeled recommendations + ~15–20 GroUSE-style unit tests; compute judge–human agreement rate before trusting Layer 2 dashboard deltas
- [ ] Step 6: Baseline snapshots — `eval_baselines` table + `POST /eval/baseline` endpoint; named snapshots of aggregated metrics before experiments; filterable by `pipeline_version`
- [ ] Step 7: Developer dashboard — `GET /eval/dashboard` serving a standalone HTML+Chart.js page with overview panel (current vs. baseline delta), pipeline funnel panel, human–LLM alignment metrics, trend charts, obscurity distribution, and event log; guarded by `EVAL_DASHBOARD_ENABLED=true`
- [ ] Step 8: User feedback button — single batch-level reaction bar after recommendations render (`Spot on` / `Too mainstream` / `Wrong direction`); disappears after 12 s or next user input
- [ ] Step 9: Golden dataset — `services/eval/golden-set.json` with 10–15 curated queries including `nuggets` and `antiBands`; `run-golden.ts` computing precision@8, antiBandRate@8 (CI fail if > 0), and nuggetCoverage@8

**Future (after data exists):**
- `search_quality_check` node in LangGraph loop: if search source quality is low, planner receives feedback and regenerates queries before extraction — only worth building once dashboard data confirms the correlation

---

## Phase 9 — Cloud Deployment (Azure Free Tier + Turso)

Deploy the Express API to Azure App Service so the desktop app can connect to a public endpoint instead of requiring a local sidecar. Consolidate on Turso/libSQL as the sole database backend for production (local `better-sqlite3` remains for offline/dev).

Independent of Phase 8 — eval instrumentation can run against a local API first; cloud deployment unlocks shared hosting and cross-device access without a running desktop sidecar.

### 9.1 — Turso chat session repository

**Files:** `services/api/src/sessions/chatSessionRepository.ts`

The chat session repository currently has only SQLite (`better-sqlite3`) and in-memory implementations. Preferences and users already have Turso adapters, but sessions do not — this is the last piece blocking a fully Turso-backed deployment.

**Action:**
1. Create `services/api/src/sessions/tursoChatSessionRepository.ts` implementing the same interface as the existing SQLite variant, using `@libsql/client`.
2. Wire it into the factory in `chatSessionRepository.ts` so that `PREFERENCE_STORE=turso` (or a dedicated `SESSION_STORE` env var) selects the Turso adapter.
3. Add unit tests mirroring the existing SQLite session tests.

---

### 9.2 — Turso migration script

**Files:** `services/api/scripts/migrate.js`

The existing migration script targets local SQLite and Postgres. It needs to also handle Turso so that the `chat_sessions`, `chat_messages`, `saved_bands`, `artist_groups`, and `artist_group_members` tables are created on the remote Turso database.

**Action:**
1. Extend `migrate.js` (or create a parallel `migrate-turso.js`) to run `CREATE TABLE IF NOT EXISTS` statements against a Turso URL using `@libsql/client`.
2. Include all tables from preferences, auth, and sessions.
3. Document the migration command in the README: `TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run migrate:turso`.

---

### 9.3 — Azure App Service deployment

Deploy the Express API to Azure App Service (F1 free tier).

**Action:**
1. Add a minimal deployment configuration — either an Azure CLI script (`scripts/deploy-azure.sh` using `az webapp up`) or a GitHub Actions workflow (`.github/workflows/deploy-azure.yml`).
2. Configure required environment variables on the App Service: `GEMINI_API_KEY`, `BRAVE_API_KEY`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `JWT_SECRET`, `PREFERENCE_STORE=turso`, `PORT` (Azure injects this automatically).
3. Ensure the `start` script in `package.json` works for Azure (it already uses `tsx services/api/src/server.js` — verify Azure's Node.js runtime supports this or add a build step that compiles to plain JS).
4. Verify health check endpoint (`GET /`) responds correctly so Azure keeps the app alive.

---

### 9.4 — Desktop app: configurable API endpoint

**Files:** `apps/desktop/src/`, `apps/desktop/src-tauri/`

The desktop app currently assumes the API runs as a local Tauri sidecar on `localhost`. For a cloud deployment, users need to be able to point the app at a remote API URL.

**Action:**
1. Add an API endpoint field to the Settings screen (`#/settings`) — default to local sidecar, allow overriding with a remote URL (e.g. `https://bandsearch.azurewebsites.net`).
2. Persist the setting in the OS config directory alongside the existing Gemini/Turso credentials.
3. When a remote endpoint is configured, skip launching the local API sidecar in the Tauri backend.
4. Update `chatClient.ts` and all API callers to use the configured endpoint.

---

### 9.5 — End-to-end verification

**Action:**
1. Create a Turso database and run the migration script against it.
2. Deploy the API to Azure App Service with `PREFERENCE_STORE=turso`.
3. Verify from the desktop app: register a user, log in, get recommendations, save artists, create groups, chat sessions persist across restarts.
4. Verify cold-start latency on the Azure free tier is acceptable (F1 has ~20–30 s cold starts).
5. Document any free-tier limitations (60 min/day CPU, cold starts) in the README.

---

### 9.6 — CI/CD pipeline (optional)

**Action:**
1. Add a GitHub Actions workflow that deploys to Azure on push to `main` (or a `deploy` branch).
2. Use Azure's publish profile or `az webapp deploy` with OIDC credentials.
3. Run `npm run ci` before deploying to prevent broken code from reaching production.

---

## Deferred / Under Review

- PWA client on shared API.
- Optional Spotify import with explicit user consent.
- Billing and subscription controls.
- Optional migration to Vertex AI governance mode.

## Architecture — Pending Deepening

The following refactors were identified during architecture review but not yet implemented. Each has a clear action and known files.

### 1. Extract auto-group inference out of the route handler

**Files:** `services/api/src/routes/registerBandsearchRoutes.ts` (lines 290–322)

The logic that fetches saved bands, calls MusicBrainz for each artist's genre, and creates/updates groups lives inline in the `POST /preferences/auto-group` HTTP handler. It is untested, has a race condition when two concurrent requests try to create the same genre group, and cannot be reused by non-HTTP callers (e.g. the import flow).

**Action:** Extract a `bandGroupInference` module (or similar name grounded in domain vocabulary) with one function: given a band name and MusicBrainz metadata, return zero or more group assignments. The route handler calls this and applies the result. Move the MusicBrainz I/O, deduplication, and group upsert logic inside the new module. Add unit tests for at least the race condition and the silent-MusicBrainz-failure path.

---

### 2. Split the monolithic preference repository interface

**Files:** `services/api/src/preferences/` — all four repository files (`sqlitePreferenceRepository.ts`, `tursoPreferenceRepository.ts`, `postgresPreferenceRepository.ts`, `preferenceMemory.ts`) plus the factory `preferenceRepository.ts`

All four implementations carry 13 methods covering three distinct concerns: band CRUD (4), context building for the recommendation pipeline (2), and group management (5 + import + status). Adding any method means touching four files.

**Action:** Split into two interfaces: `BandRepository` (CRUD + context building) and `BandGroupRepository` (group operations + import). Each adapter implements only its relevant interface. The factory selects both implementations for the active store. The context-building methods (`buildContext`, `buildContextForIds`) move closer to the recommendation pipeline, where the LLM prompt format is the real concern.

---

### 3. Consolidate the HTTP retry seam shared by integration clients

**Files:** `services/api/src/integrations/musicbrainz.ts`, `braveSearch.ts`

`fetchWithTimeoutAndRetry` is copied verbatim in both files — same function, same signature, same AbortController pattern. A bug fix or timeout policy change must be applied in two places.

**Action:** Extract `fetchWithTimeoutAndRetry` into a shared `services/api/src/integrations/httpClient.ts` module. Both `musicbrainz.ts` and `braveSearch.ts` import from it. Add a focused test for the retry and timeout behaviour in the new shared module; remove the duplicated copies from both clients.

---

### 4. Remove duplicated user repository helpers

**Files:** `services/api/src/auth/userRepository.ts`, `tursoUserRepository.ts`

`normalizeEmail()`, `publicUser()`, and `rowToUser()` are copied verbatim in both user repository adapters.

**Action:** Move the three functions into a shared `services/api/src/auth/userModel.ts` module. Both adapters import from it. The factory in `userRepository.ts` is unchanged. Test `normalizeEmail` once in `userModel.test.ts`.

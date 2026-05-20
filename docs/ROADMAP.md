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

## Phase 4 — Prompt safety & injection guardrails

- Harden the recommendation pipeline against **prompt injection** and misuse of the model via crafted user or chat history: keep trusted system/developer instructions structurally separate from untrusted text; normalize and cap length of queries and forwarded messages before they reach Gemini.
- Layered defenses where practical: delimiter or envelope patterns for conversation history, server-side checks or sanitization before `runModel`, clear refuse/strip policies for known jailbreak patterns, and structured logging (and optional metrics) when requests are blocked or trimmed.
- Regression coverage and docs: automated tests with representative injection probes; short threat model and residual-risk notes in domain docs (`CONTEXT.md` / `docs/adr/`) so future prompt changes stay reviewable.

## Phase 4.5 — Data Portability, Sharing & Saved Artists Organisation

- Export / import saved artists as JSON for backup and device transfer.
- Shareable recommendations: copy-to-clipboard for a formatted recommendation list (artist + why-text).
- **Artist grouping**: group saved artists by genre (fetched from MusicBrainz) or by user-defined custom tags/criteria, with the ability to create, rename, and delete groups and drag artists between them.

## Phase 5.5 — Cross-device Sync (Turso)

- Sync preference data via Turso/libSQL between desktop and phone. Turso is SQLite-compatible with a remote replica: the desktop writes locally (offline-capable) and syncs automatically to the cloud. A future mobile app or web client reads from the same remote database.
- Minimal invasive: new `TursoPreferenceRepository` adapter for libSQL, activated via `PREFERENCE_STORE=turso`. Connection string and auth token configurable through the settings UI (Phase 3.5).
- Foundation for Phase 6 multi-user: Turso supports per-user namespacing and row-level security.

## Phase 6 — Auth and Multi-user

- Multi-user support: auth/session layer and user-scoped preference ownership.
- User-linked preference schema evolution (`user_id`) and repository updates.
- API auth middleware and route protection for preference endpoints.
- Basic onboarding/login UX flow in the desktop client.

## Phase 7 — Platform Expansion

- Windows: Tauri already produces a Windows installer via `tauri build`; the main work is sidecar binary naming (`node-x86_64-pc-windows-msvc.exe` in `tauri.conf.json`) and adding a Windows runner to CI.
- Android: use Tauri's Android target (`tauri android init`). Voice input as the primary chat input method via the Web Speech API (`SpeechRecognition`), which works natively in Chromium-based Android webviews — no native plugin needed. Requires responsive layout review and touch-friendly tap targets throughout the UI.

## Parallel Track — Incremental TypeScript Migration (Non-blocking)

- Goal: improve refactor safety and reduce runtime contract drift while continuing feature delivery.
- Rule: no big-bang rewrite; convert touched files/modules incrementally during normal work.
- Start with high-risk boundaries first: recommendation pipeline, API route contracts, desktop chat/render adapters.
- Enable gradual typing with mixed JS/TS support (`allowJs` + `checkJs`) and migrate modules to `.ts` as they stabilize.
- ✓ Done: `shared/schemas/src/contracts.ts`; API recommendation stack (`recommendations.ts`, `recommendationPipeline.ts`, `recommendationAgent.ts`); HTTP helpers (`http/errors.ts`, `http/artistSearchHandler.ts`) and `registerBandsearchRoutes.ts`. `npm run dev` / `@bandsearch/api` tests run via **tsx** so TypeScript loads next to remaining JavaScript.
- ✓ Done: first-run welcome route (`#/welcome`), `WelcomeView`, `firstRunOnboarding.ts` gate + persistence (`complete_onboarding` / `onboarding_completed` in Tauri config; `bandsearch_onboarding_complete` in browser dev); desktop tests run with **tsx**.
- ✓ Done: chat recommendation failures map API error codes to readable banners via `apiErrorMessages.ts` (`rate_limit_exceeded`, pipeline init, MusicBrainz context, Gemini unavailable, connectivity).
- Keep this track side-by-side with product phases; do not block UX/features on migration tasks.

## Deferred / Under Review

- PWA client on shared API.
- Optional Spotify import with explicit user consent.
- Billing and subscription controls.
- Optional migration to Vertex AI governance mode.

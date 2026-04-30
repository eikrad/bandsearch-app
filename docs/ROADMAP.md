# Bandsearch Roadmap

## Completed (Phase 0-2)

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

## Next Up (Phase 3)

- Playwright browser smoke tests: verify the built app actually renders in a real browser (current unit tests run in Node.js and cannot catch browser-only failures like `require()` in browser context).
- Multi-user support: auth/session layer and user-scoped preference ownership.
- User-linked preference schema evolution (`user_id`) and repository updates.
- API auth middleware and route protection for preference endpoints.
- Basic onboarding/login UX flow in desktop client.

## Later (Phase 4+)

- PWA client on shared API.
- Optional Spotify import with explicit user consent.
- Billing and subscription controls.
- Optional migration to Vertex AI governance mode.

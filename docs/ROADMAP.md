# Bandsearch Roadmap

## Completed (Phase 0-1)

- Monorepo foundation, CI baseline, Apache-2.0 licensing.
- Recommendation core with MusicBrainz + LangChain + Gemini.
- Explainable responses (`why`, `sourceTags`, `sourceSignals`).
- API hardening: structured errors, rate limits, timeout/retry, request logging.
- Desktop chat UI foundation: recommendation cards, mode switching, save/rate actions, feedback states.

## In Progress (Phase 2-3)

- Preference memory: save bands, ratings, categories, notes.
- Search modes: `fresh` and `preference-aware`.
- Persistence abstraction: `PreferenceRepository` interface to decouple storage from API routes.
- Database-backed preferences (Postgres/Supabase) replacing in-memory repository.

- Tauri UX hardening and E2E smoke coverage.

## Next Up (Phase 3)

- Multi-user support: auth/session layer and user-scoped preference ownership.
- User-linked preference schema evolution (`user_id`) and repository updates.
- API auth middleware and route protection for preference endpoints.
- Basic onboarding/login UX flow in desktop client.

## Later (Phase 4+)

- PWA client on shared API.
- Optional Spotify import with explicit user consent.
- Billing and subscription controls.
- Optional migration to Vertex AI governance mode.

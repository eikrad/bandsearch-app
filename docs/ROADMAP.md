# Bandsearch Roadmap

## Now (Phase 0-1)

- Monorepo foundation, CI baseline, Apache-2.0 licensing.
- Recommendation core with MusicBrainz + LangChain + Gemini.
- Explainable responses (`why`, `sourceTags`, `sourceSignals`).

## Next (Phase 2-3)

- Preference memory: save bands, ratings, categories, notes.
- Search modes: `fresh` and `preference-aware`.
- Tauri UX hardening and E2E smoke coverage.
- Persistence abstraction: `PreferenceRepository` interface to decouple storage from API routes.
- Database-backed preferences (Postgres/Supabase) replacing in-memory repository.
- Multi-user support: auth/session layer and user-scoped preference ownership.

## Later (Phase 4+)

- PWA client on shared API.
- Optional Spotify import with explicit user consent.
- Billing and subscription controls.
- Optional migration to Vertex AI governance mode.

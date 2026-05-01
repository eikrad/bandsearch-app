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

- Playwright browser smoke tests: verify the built app actually renders in a real browser. ✓ Done.
- Compact card layout: reduce card height and visual weight so more results fit on screen without scrolling. Pure CSS/layout change, no data model impact.
- Saved Artists page: dedicated view for managing saved artists, requiring in-app client-side routing (currently the app is single-view). Two sub-features:
  - MusicBrainz search to find and add artists by name directly, without going through the recommendation flow.
  - Directional selection (tick/checkbox) to mark which saved artists should act as style references for the next search — these get injected as a priority preference context alongside the normal query.

## Phase 4 — Richer Artist Data

- Artist pictures: display a photo on each artist card. MusicBrainz does not provide artist photos; recommended source is Wikimedia Commons via the Wikidata API (free, no API key, permissive licensing) with Last.fm as a fallback. Images should lazy-load and degrade gracefully to a placeholder when unavailable.
- Music platform links: from any artist card, surface links to listen on Bandcamp (preferred — supports independent artists), SoundCloud, and Spotify as progressively available fallbacks. Implement as deep search links rather than embedded players to avoid OAuth and iframe complexity; surface platform icons only when a match is reasonably confident.

## Phase 5 — Conversational Interface

- Full chat interface: replace the single-query input with a scrollable message thread so users can refine or follow up on results in a back-and-forth dialogue. Requires passing conversation history to the Gemini prompt so it has context across turns; the API `POST /recommendations` needs a `messages` parameter alongside `query`.
- Save and continue chats: persist chat sessions to SQLite (`chat_sessions`, `chat_messages` tables) and expose a session list so users can resume past conversations. Naturally builds on the routing layer introduced in Phase 3 and the chat interface above.

## Phase 6 — Auth and Multi-user

- Multi-user support: auth/session layer and user-scoped preference ownership.
- User-linked preference schema evolution (`user_id`) and repository updates.
- API auth middleware and route protection for preference endpoints.
- Basic onboarding/login UX flow in the desktop client.

## Phase 7 — Platform Expansion

- Windows: Tauri already produces a Windows installer via `tauri build`; the main work is sidecar binary naming (`node-x86_64-pc-windows-msvc.exe` in `tauri.conf.json`) and adding a Windows runner to CI.
- Android: use Tauri's Android target (`tauri android init`). Voice input as the primary chat input method via the Web Speech API (`SpeechRecognition`), which works natively in Chromium-based Android webviews — no native plugin needed. Requires responsive layout review and touch-friendly tap targets throughout the UI.

## Deferred / Under Review

- PWA client on shared API.
- Optional Spotify import with explicit user consent.
- Billing and subscription controls.
- Optional migration to Vertex AI governance mode.

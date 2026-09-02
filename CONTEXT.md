# Bandsearch

AI-powered music recommendations for niche and lesser-known artists. Combines conversational AI with MusicBrainz metadata and preference memory.

## Glossary

- **Recommendation pipeline** — the end-to-end flow that turns a user query (plus optional preference context) into final recommendation items. The only pipeline is the research pipeline (Brave + LangGraph + MusicBrainz); there is no classic fallback. `BRAVE_API_KEY` is required.

- **Research graph** — the LangGraph state machine in `agent/research/researchGraph.ts` that orchestrates: web search planning, Brave search execution, candidate extraction, MusicBrainz verification, optional reflection, and final ranking.

- **Search plan** — the structured output of the `plan` node: a list of targeted Brave search queries derived from the user's taste (FFO/Bandcamp-style signals, anchor artists, style descriptors).

- **Extracted candidate** — a band name pulled from Brave search snippets by the `extract` node. Not yet verified against MusicBrainz.

- **Verified candidate** — an extracted candidate confirmed by MusicBrainz `lookupArtist` and enriched with `mbid`, genres, tags, and URL relations.

- **Reflection subgraph** — a nested LangGraph subgraph that runs up to `maxRounds` additional search-extract-verify cycles when the initial pass yields fewer than `RESEARCH_TARGET_VERIFIED_CANDIDATES` verified hits.

- **Research budget** — a wall-clock time limit (`RESEARCH_TIMEOUT_MS`) shared across all graph nodes. When exhausted, conditional edges route directly to `END` gracefully instead of timing out mid-flight.

- **Preference context** — a formatted string built from the user's saved bands (ratings, categories, notes) and injected into Gemini prompts for `preference-aware` mode recommendations.

- **Saved band** — an artist the user has kept in their preference memory. Saving is itself a signal of interest; it does not require the user to judge the artist. A saved band may carry a rating, categories and a note, all optional.

- **Rating** — an optional 1–5 judgement on a saved band. A band that is saved but not yet rated is a distinct, legitimate state: "I want to remember this, I have not decided how much I like it." A rating expresses strength of preference only — it never determines ranking or ordering by itself; its whole effect is that it appears in the preference context the recommendation prompt reads.

- **Category** — a free-text tag the user puts on one saved band. Categories **shape what gets recommended**: they are part of the preference context sent to the model. Distinct from an artist group despite the similar wording — see below.

- **Artist group** — a named collection of saved bands, with its own identity, used to browse and organise a collection. A group **does not influence recommendations**; it never reaches the preference context. The rule of thumb: a category says something about a band's character, a group says where the user filed it.

- **Note** — free text on a saved band. It is pre-filled with the model's own explanation of why it recommended the artist, and the user can edit it via the `···` Category/Note sheet on a recommendation card.

  **Built (ADR 0002, #192, merged 2026-08-31):** only a note the user has actually written or edited counts as their own preference signal and reaches the recommendation prompt; one left at its pre-filled value stays visible but out of the prompt, so the model cannot read its own words back as if the user had said them. This is tracked in storage via `noteEdited` (`services/api/src/savedBandContext.ts` and the `note_edited` column added in migration `004_note_edited.sql`) and set `true` only when the user actually edits the sheet's textarea. Tracking issue #166 remains open on GitHub only because this repo's PRs target `staging`, where `Closes #166` never auto-fires — see `AGENTS.md`.

- **Obscurity target** — a user-selectable signal (`Cult Following` / `Underground` / `Truly Obscure`) passed to the planner to tune search queries toward less or more obscure artists. Stored per recommendation event.

- **Eval layer** — an async, non-blocking quality-scoring system that runs after the HTTP response is sent. Three tiers: (1) automatic metrics — Last.fm obscurity score and pipeline funnel counts; (1.5) deterministic checks — citation support rate and generic-why detection; (2) LLM-as-judge — scores each band asynchronously (optional, requires `MISTRAL_API_KEY`).

- **LLM-as-judge** — an async eval worker that scores each recommended band on relevance, obscurity fit, evidence quality, and discovery value. Only active when `MISTRAL_API_KEY` is set; never on the critical response path.

- **Golden dataset** — a curated set of queries in `services/eval/golden-set.json` with expected `nuggets` (bands that should appear) and `antiBands` (bands that should not). The eval runner (`run-golden.ts`) computes `antiBandRate@8` and fails CI if it exceeds 50%.

- **Progressive auth** — a three-mode auth scheme determined at runtime by the number of registered users: 0 users → pass-through (no token needed), 1 user → auto-attach (all requests associated with the single user), ≥2 users → JWT enforced (`Authorization: Bearer <token>`).

- **Preference repository** — the abstract storage interface for saved bands, artist groups, and user accounts. Concrete adapters: SQLite (`better-sqlite3`), Turso/libSQL (direct, or a local replica synced via `turso-sync`), and in-memory. A Postgres adapter existed early on and was removed for lacking user scoping (see `docs/ROADMAP.md`, "Architecture — Pending Deepening" entry 8); `PREFERENCE_STORE=postgres` now throws on startup rather than connecting to anything.

- **Session store** — separate from the preference store; holds `chat_sessions` and `chat_messages`. Adapters: SQLite (`better-sqlite3`), in-memory, and Turso/libSQL (`tursoChatSessionRepository`). Selected via `PREFERENCE_STORE` env var alongside the preference and user repositories.

- **Sidecar** — the Node.js API process spawned as a child process by the Tauri desktop shell. In development, it uses the system `node`. In production bundles, a bundled Node binary named `node-<target-triple>[.exe]` is expected in `apps/desktop/src-tauri/binaries/`.

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

- **Obscurity target** — a user-selectable signal (`Cult Following` / `Underground` / `Truly Obscure`) passed to the planner to tune search queries toward less or more obscure artists. Stored per recommendation event.

- **Eval layer** — an async, non-blocking quality-scoring system that runs after the HTTP response is sent. Three tiers: (1) automatic metrics — Last.fm obscurity score and pipeline funnel counts; (1.5) deterministic checks — citation support rate and generic-why detection; (2) LLM-as-judge — Claude scores each band asynchronously (optional, requires `ANTHROPIC_API_KEY`).

- **LLM-as-judge** — an async eval worker using Claude to score each recommended band on relevance, obscurity fit, evidence quality, and discovery value. Only active when `ANTHROPIC_API_KEY` is set; never on the critical response path.

- **Golden dataset** — a curated set of queries in `services/eval/golden-set.json` with expected `nuggets` (bands that should appear) and `antiBands` (bands that should not). The eval runner (`run-golden.ts`) computes `antiBandRate@8` and fails CI if it exceeds 50%.

- **Progressive auth** — a three-mode auth scheme determined at runtime by the number of registered users: 0 users → pass-through (no token needed), 1 user → auto-attach (all requests associated with the single user), ≥2 users → JWT enforced (`Authorization: Bearer <token>`).

- **Preference repository** — the abstract storage interface for saved bands, artist groups, and user accounts. Concrete adapters: SQLite (`better-sqlite3`), Postgres, Turso/libSQL, and in-memory.

- **Session store** — separate from the preference store; holds `chat_sessions` and `chat_messages`. Currently only has a SQLite and in-memory adapter (Turso adapter is planned in Phase 9).

- **Sidecar** — the Node.js API process spawned as a child process by the Tauri desktop shell. In development, it uses the system `node`. In production bundles, a bundled Node binary named `node-<target-triple>[.exe]` is expected in `apps/desktop/src-tauri/binaries/`.

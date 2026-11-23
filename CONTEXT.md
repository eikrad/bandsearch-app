# Bandsearch

AI-powered music recommendations for niche and lesser-known artists. Combines conversational AI with MusicBrainz metadata and preference memory.

## Glossary

- **Recommendation pipeline** — the end-to-end flow that turns a user query (plus optional preference context) into final recommendation items. The only pipeline is the research pipeline (Brave + LangGraph + MusicBrainz); there is no classic fallback. `BRAVE_API_KEY` is required.

- **Conversation turn** — how one chat message is answered: by a **search** (the research graph), by a **pick** (ranking bands the conversation already found but has not shown) or by an **answer** in words (no bands). The turn router decides; when in doubt it searches.

- **Conversation memory** — the bands found and shown per user and conversation, in the server's memory for two hours. It makes picks possible and keeps shown bands from being shown again. Public artist data only, never what the user wrote.

- **Research graph** — the LangGraph state machine in `agent/research/researchGraph.ts` that orchestrates: web search planning, Brave search execution, candidate extraction, MusicBrainz verification, optional reflection, and final ranking.

- **Last.fm round** — the first candidate source of a search: the bands Last.fm's listeners file next to the anchor artists. With enough verified bands of the requested size the search is answered from them; otherwise the web is searched too. Not used for Truly Obscure, nor for a demand similarity cannot show, such as "with female vocals".

- **Search plan** — the structured output of the `plan` node: a list of targeted Brave search queries derived from the user's taste (FFO/Bandcamp-style signals, anchor artists, style descriptors).

- **Extracted candidate** — a band name pulled from Brave search snippets by the `extract` node, with the URLs and words of the hits that name it. Not yet verified against MusicBrainz.

- **Verified candidate** — an extracted candidate that MusicBrainz lists under the same name or alias (case, accents, punctuation and a leading "The" aside), enriched with its `mbid`, tags, country and life span. An artist whose name merely resembles the candidate does not verify it. Names are searched in batches, not one by one.

- **Reflection subgraph** — a nested LangGraph subgraph that asks the reflector whether the verified candidates meet `RESEARCH_TARGET_VERIFIED_CANDIDATES`, then runs up to `maxRounds` additional search-extract-verify cycles while the reflector asks for more and at least 25 s of research time remain.

- **Research budget** — a wall-clock time limit (`RESEARCH_TIMEOUT_MS`) for the complete research graph, including final ranking and retries. Research ends early to reserve up to 12 seconds (at most one third of the configured budget) for ranking. At that cutoff, in-flight research is cancelled, completed verification results are kept, and remaining research stages are skipped. Ranking must finish within both its 12-second cap and the total deadline; if it cannot, or the ranker fails, the request fails (`502 recommendation_unavailable`) instead of returning unranked research.

- **Preference context** — a formatted string built from the user's saved bands (ratings, categories, notes) and injected into the LLM prompts for `preference-aware` mode recommendations.

- **Saved band** — an artist the user has kept in their preference memory. Saving is itself a signal of interest; it does not require the user to judge the artist. A saved band may carry a rating, categories and a note, all optional.

- **Saved-band actions** — Save, Rate, Category/Note, and removal, applied to the artist selected on a recommendation card or in artist search. A present MusicBrainz ID is authoritative: a different ID never matches by name. Only an artist without an ID uses normalized-name fallback. Cards for the same identity share saved state and annotations across turns. Saving an existing band preserves its annotations; rating changes only the rating, and Category/Note changes those fields without replacing untouched note text or provenance. The selected recommendation's suggested note is used only on first save.

- **Rating** — an optional 1–5 judgement on a saved band. A band that is saved but not yet rated is a distinct, legitimate state: "I want to remember this, I have not decided how much I like it." A rating expresses strength of preference only — it never determines ranking or ordering by itself; its whole effect is that it appears in the preference context the recommendation prompt reads.

- **Category** — a free-text tag the user puts on one saved band. Categories **shape what gets recommended**: they are part of the preference context sent to the model. Distinct from an artist group despite the similar wording — see below.

- **Artist group** — a named collection of saved bands, with its own identity, used to browse and organise a collection. A group **does not influence recommendations**; it never reaches the preference context. The rule of thumb: a category says something about a band's character, a group says where the user filed it.

- **Note** — free text on a saved band. It is pre-filled with the model's own explanation of why it recommended the artist, and the user can edit it via the `···` Category/Note sheet on a recommendation card.

  **Built (ADR 0002, #192, merged 2026-08-31):** only a note the user has actually written or edited counts as their own preference signal and reaches the recommendation prompt; one left at its pre-filled value stays visible but out of the prompt, so the model cannot read its own words back as if the user had said them. This is tracked in storage via `noteEdited` (`services/api/src/savedBandContext.ts` and the `note_edited` column added in migration `004_note_edited.sql`) and set `true` only when the user actually edits the sheet's textarea. Tracking issue #166 remains open on GitHub only because this repo's PRs target `staging`, where `Closes #166` never auto-fires — see `AGENTS.md`.

- **Obscurity target** — a user-selectable signal (`Cult Following` / `Underground` / `Truly Obscure`) passed to the planner to tune search queries toward less or more obscure artists. Stored per recommendation event. Each target is a Last.fm listener *range*, both ends included: Cult Following 20k–500k, Underground 2k–50k, Truly Obscure up to 5k (`services/api/src/obscurityTargets.ts`, #325). The ranges overlap on purpose. A band below the range misses the target just as one above it does. These are not the **obscurity tiers** of the eval chart, which sort every band into exactly one tier with their own cut points (`eval/obscurityScorer.ts`).

  Before ranking, the research filter drops the far misses: bands more than ten times outside the range, in either direction (`NEAR_MISS_FACTOR`). Near misses stay in the pool behind the in-range bands, because only the ranker sees the query's hard constraints ("from Japan"); it is told to pick one only when too few in-range bands fit the query. If fewer than five bands are left, the nearest far misses fill up the pool. The eval still counts a near miss as outside the range. A candidate without a Last.fm count counts as obscure. When no candidate has one (Last.fm off or down), nothing is filtered. The eval's in-range rate, the judge's `target_range_fit` and the research log fit bands by this same rule, through `fitObscurityTarget`, so the eval measures what the search does.

  The ranker is given the range and each candidate's `target_range_fit`, by the same rule. The planner is given the range and a source mix per target. Because only the first queries are searched in the initial round, Bandcamp queries go last for Cult Following and alternate with the others for Underground: Bandcamp finds the smallest acts.

- **Eval layer** — an async, non-blocking quality-scoring system that runs after the HTTP response is sent. Three tiers: (1) automatic metrics — Last.fm obscurity score and pipeline funnel counts; (1.5) deterministic checks — citation support rate and generic-why detection; (2) LLM-as-judge — scores each band asynchronously (optional, requires `SCW_SECRET_KEY`).

- **Recommendation feedback** — a user's reaction to a recommendation batch: good, too mainstream, or wrong direction. Unlike a rating, it evaluates a batch rather than one saved band. It is product data, not eval telemetry: it lives in the main database next to the account it belongs to, works with the eval dashboard off, and is read by the operator on demand with `npm run feedback:list` — deliberately not an email digest, a dashboard or an admin endpoint (#307). Each verdict carries the batch it judges (query, mode, obscurity target, the bands shown), because in production nothing else records the batch. One verdict per batch and user; a later click replaces the earlier one. The owner comes from authentication, never from the request; a personal install without accounts records it without one. Included in account export and deletion, and deleted after 90 days.

- **LLM-as-judge** — an async eval worker that scores each recommended band on relevance, obscurity fit, evidence quality, and discovery value. Obscurity fit is two-sided: a band below its **obscurity target**'s listener range is penalised like one above it (#325). Runs on Scaleway (`SCW_JUDGE_MODEL`, never the research model) and is only active when `SCW_SECRET_KEY` is set; checked against human labels by `run-calibration.ts`; never on the critical response path.

- **Golden dataset** — a curated set of queries in `services/eval/golden-set.json` with `nuggets` (atomic sonic properties — genre, era, trait) and `antiBands` (bands that must not appear). The eval runner (`run-golden.ts`) scores `nuggetCoverage@8` against MusicBrainz tags/genres of the top-8 recommendations (fail below per-entry `minNuggetCoverage`, default 0.5) and `antiBandRate@8` (fail if > 50%; `--strict` fails on any hit). There is no `expectedBands` list: open-ended retrieval has no single correct answer set.

- **Constraint query** — a golden query with hard facts every recommended band must meet (country, formed after/before, split up, shares a member with a band), checked against MusicBrainz with plain code rather than tags or a judge. A band is *met*, *missed*, or *unknown* when MusicBrainz does not record the fact; `constraintRate@8` is the share of decided bands that are met.

- **Golden run** — one execution of the golden dataset against an API, recorded as a line in `services/eval/history/golden-runs.jsonl` with the model the API reported. A query the API did not answer has status `error` and no metrics; it never counts as a regression. The run labelled `baseline` (the latest such) is what later runs are compared against.

- **Setup** — golden runs that differ only by chance: same research model, code, replay mode, grading targets and metrics version. Repeats of a setup (`--repeat N`) are averaged per query before two setups are compared.

- **Replay** — eval-only recording of Brave, MusicBrainz and Last.fm answers (`EVAL_REPLAY_DIR`), so setups compared on the golden set see the same search data. LLM calls are never replayed, and a batched MusicBrainz search replays only when a run extracts the same names again.

- **Noise floor** — the top-8 overlap between golden runs of an identical setup (same model, pipeline version, commit, grading targets). An overlap with the baseline close to it means a change moved the answers no more than chance does. Overlap is a **stability** signal, not a quality one: varied answers to the same query are wanted (product decision 2026-10-05, so re-asking can surface new bands).

- **Progressive auth** — the default `AUTH_MODE`, meant for personal installs: a three-mode scheme determined at runtime by the number of registered users: 0 users → pass-through (no token needed), 1 user → auto-attach (all requests associated with the single user), ≥2 users → JWT enforced (`Authorization: Bearer <token>`). Contrast **Enforced auth**.

- **Enforced auth** — `AUTH_MODE=enforced`, for a closed hosted deployment: every protected request needs a valid token for an existing, non-disabled user, with no 0/1-user shortcuts; `/artists/*` is protected; `JWT_SECRET` is required; registration needs an **Invite**. Not to be confused with the ≥2-users case of progressive auth.

- **Invite** — an email-bound, single-use, 14-day registration code for a closed deployment. 128 random bits, stored only as a SHA-256 hash, issued and revoked by the operator through the CLI (`invite:create|list|revoke`). The email is not verified; the code is the secret, and the binding makes a forwarded code useless to anyone but the invited address. A **disabled** user (`user:disable`) keeps their data but is refused at login and on every request.

- **Storage** — the module that opens the database chosen by `PREFERENCE_STORE` and returns every store the API uses (`services/api/src/storage/createStorage.ts`). Despite its name, `PREFERENCE_STORE` selects the backend for all account data — preferences, artist groups, users, invites, chat sessions, recommendation feedback and account export/erasure — never just preferences. A backend that cannot be opened stops startup; nothing falls back to memory or a local file. It also chooses the eval store, which is operator telemetry and never lives on Turso: a no-op with the dashboard off, otherwise a local SQLite file (memory on a memory install). Opened once by the server (`openStorage`, async because of the turso-sync replica) and by the admin CLI (`openAdminStorage`, which goes to the cloud database directly under turso-sync).

- **Preference repository** — the abstract storage interface for saved bands, artist groups, and user accounts. Concrete adapters: SQLite (`better-sqlite3`), Turso/libSQL (direct, or a local replica synced via `turso-sync`), and in-memory. A Postgres adapter existed early on and was removed for lacking user scoping (see `docs/ROADMAP.md`, "Architecture — Pending Deepening" entry 8); `PREFERENCE_STORE=postgres` now throws on startup rather than connecting to anything.

- **Session store** — separate from the preference store; holds `chat_sessions` and `chat_messages`. Adapters: SQLite (`better-sqlite3`), in-memory, and Turso/libSQL (`tursoChatSessionRepository`). Selected via `PREFERENCE_STORE` env var alongside the preference and user repositories.

- **App session** — the desktop module that decides which screen the user may see: Welcome, Connecting, Login, Register, or the app (`apps/desktop/src/appSession.ts`). It holds what that decision reads — the account flags from `/auth/status`, the token, the Connecting progress — and handles every event that changes it: startup, Retry, login, registration, password reset, account deletion and a rejected token. Events only change the token; every way into the chat goes through `enterApp()`, which asks `/auth/status` again unless this run has already let the user in. Ordinary moves between Chat, Saved Artists, Settings and Privacy are plain navigation and not its business (#313).

- **Sidecar** — the Node.js API process spawned as a child process by the Tauri desktop shell. In development, it uses the system `node`. In production bundles, a bundled Node binary named `node-<target-triple>[.exe]` is expected in `apps/desktop/src-tauri/binaries/`.

# Bandsearch Architecture

## Overview

Bandsearch is an AI-powered music recommendation system that discovers niche and lesser-known artists based on user taste. It is a monorepo containing a TypeScript/Express API backend, a Tauri+React desktop client, and shared validation contracts.

---

## System overview

```mermaid
graph LR
    USER([User]) --> DESK[Tauri Desktop\nReact UI]
    USER --> BROWSER[Browser UI]
    DESK --> API[Express API\nNode.js :3001]
    BROWSER --> API
    API --> GRAPH[LangGraph\nResearch Pipeline]
    GRAPH --> GEMINI[Google Gemini\nplan · extract · reflect · rank]
    GRAPH --> BRAVE[Brave Search API\nniche artist discovery]
    GRAPH --> MB[MusicBrainz\nartist verification]
    GRAPH --> DB[(SQLite / Postgres\n/ Turso)]
```

---

## Monorepo structure

```
bandsearch-app/
├── apps/
│   └── desktop/         — Tauri + React desktop application (Rust + TypeScript)
├── services/
│   └── api/             — Express.js API server (TypeScript, Node.js 26+)
│   └── eval/            — Golden dataset and eval runner
├── shared/
│   └── schemas/         — Shared TypeScript validation contracts
├── docs/                — Architecture docs, ADRs, design specs, roadmap
├── scripts/             — Build and lint utilities
└── tests/               — End-to-end tests (Playwright)
```

Root `main.py` / `pyproject.toml` / `uv.lock` are an unused placeholder scaffold, kept only so `npm run lint:py` (ruff + black) has something to check — they're not part of the running application.

---

## System topology

How the pieces connect at runtime. Solid arrows are always active; dashed lines require their corresponding API key.

```mermaid
graph TD
    USER([User]) --> DESKTOP

    subgraph DESKTOP["Desktop App (apps/desktop)"]
        direction LR
        UI[React UI]
        SHELL[Tauri Shell / Rust]
    end

    SHELL -->|spawns Node.js child process| API

    subgraph BACKEND["API Server (services/api)"]
        API[Express API]
        PIPELINE[LangGraph Pipeline]
        API --> PIPELINE
    end

    PIPELINE --> GEMINI[Google Gemini\nplan · extract · rank]
    PIPELINE --> BRAVE[Brave Search API\ndiscovery queries]
    PIPELINE --> MB[MusicBrainz\nartist verification]

    API --> DB[("SQLite / Postgres / Turso\npreferences · sessions · auth")]

    API -.->|optional| LASTFM[Last.fm\nartist images + obscurity score]
    PIPELINE -.->|optional tracing| LANGSMITH[LangSmith]
    API -.->|optional async eval| CLAUDE[Anthropic Claude\nLLM-as-Judge]
```

---

## API Server (`services/api`)

The API is an Express.js application structured as follows:

| Module | Responsibility |
|--------|---------------|
| `server.ts` | Entry point — validates env, initializes pipeline, starts HTTP listener |
| `app.ts` | Express app factory — middleware (helmet, CORS, rate-limit, JSON logging) and route registration |
| `routes/registerBandsearchRoutes.ts` | Mounts all route handlers (auth, recommendations, preferences, sessions, artist search) |
| `recommendationPipeline.ts` | Lifecycle manager for the research graph — exposes `recommend()` and `whenReady()` |
| `agent/research/researchService.ts` | Thin wrapper around `invokeResearchGraph()` with error handling |

### REST routes

Registered by `routes/registerBandsearchRoutes.ts` (auth, recommendations, sessions, preferences, artist search) and `eval/evalRoutes.ts` (eval dashboard and data).

| Group | Routes |
|-------|--------|
| Health / version | `GET /health`, `GET /version` |
| Auth | `GET /auth/status`, `POST /auth/register`, `POST /auth/login`, `POST /auth/reset-password` |
| Recommendations | `POST /recommendations` |
| Sessions | `POST /sessions`, `GET /sessions`, `GET /sessions/:id`, `POST /sessions/:id/messages` |
| Artists | `GET /artists/search`, `GET /artists/image` |
| Preferences | `GET/POST /preferences`, `PATCH/DELETE /preferences/:id`, `GET /preferences/context`, `GET /preferences/export`, `POST /preferences/import`, `POST /preferences/turso/test` |
| Preference groups | `GET/POST /preferences/groups`, `POST /preferences/groups/auto`, `PATCH/DELETE /preferences/groups/:id`, `POST /preferences/groups/:id/artists`, `DELETE /preferences/groups/:id/artists/:savedBandId` |
| Eval | `GET /eval/events`, `GET /eval/metrics`, `POST /eval/baseline`, `GET /eval/baselines`, `POST /eval/feedback`, `GET /eval/dashboard` (Basic Auth if `EVAL_DASHBOARD_PASSWORD` is set) |

---

## LangGraph pipeline

The core recommendation logic is a LangGraph state machine defined in `agent/research/researchGraph.ts`.

### Graph state (`ResearchGraphState`)

| Field | Type | Description |
|-------|------|-------------|
| `userQuery` | `string` | Raw user input |
| `preferenceContext` | `string` | Formatted saved-band context |
| `messages` | `ChatMessage[]` | Conversation history |
| `mode` | `RecommendationMode` | `fresh` or `preference-aware` |
| `obscurityTarget` | `string` (optional) | User-selected obscurity target (`Cult Following` / `Underground` / `Truly Obscure`); filters candidates before ranking |
| `searchPlan` | `SearchPlan` | Planner output (anchor artists, style signals, queries) |
| `braveHits` | `SearchHitInput[]` | Raw web search results |
| `extractedCandidates` | `ExtractedCandidate[]` | Band names extracted from snippets |
| `verifiedCandidates` | `VerifiedCandidate[]` | MusicBrainz-verified candidates with metadata |
| `searchCallsUsed` | `number` | Brave API call counter |
| `reflectionUsed` | `boolean` | Whether reflection ran |
| `recommendations` | `unknown[]` | Final ranked output |
| `assistantReply` | `string` | Optional conversational prose |

### Main graph

```mermaid
flowchart TD
    START(["START"]) --> plan["plan\nGemini — builds Brave queries\nfrom user taste"]
    plan --> brave_initial["brave_initial\nBrave Search API\nup to RESEARCH_MAX_INITIAL_SEARCHES"]
    brave_initial --> extract["extract\nGemini — extracts band names\nfrom search snippets"]
    extract --> verify["verify\nMusicBrainz — adds mbid,\ngenres, tags, URL relations"]
    verify --> reflect_if_needed["reflect_if_needed\nReflection Subgraph\n(runs if verified count < target)"]
    reflect_if_needed --> enrich_lastfm["enrich_lastfm\nLast.fm (optional) — similar-artist\nmatches + listener counts"]
    enrich_lastfm --> rank["rank\nGemini — final ranked list\nwith evidence-grounded why text"]
    rank --> END(["END"])
```

| Node | Model / Service | Description |
|------|----------------|-------------|
| `plan` | Gemini | Generates targeted Brave search queries from user taste (FFO/Bandcamp-style) |
| `brave_initial` | Brave Search API | Executes up to `RESEARCH_MAX_INITIAL_SEARCHES` queries with dedup cache |
| `extract` | Gemini | Identifies band names from snippets; filters out anchor artists |
| `verify` | MusicBrainz | Looks up each candidate; adds `mbid`, genres, tags, URL relations |
| `reflect_if_needed` | Reflection Subgraph | Conditionally runs extra searches when verified count < target |
| `enrich_lastfm` | Last.fm (optional) | Adds similar-artist matches (vs. anchor artists) and listener counts to verified candidates; no-op if `LASTFM_API_KEY` unset |
| `rank` | Gemini | Produces final ranked list with evidence-grounded `why` text and optional prose reply |

### Reflection subgraph (`reflectionSubgraph.ts`)

Embedded as a compiled LangGraph subgraph within `reflect_if_needed`. Runs up to `maxRounds` (default 2) additional search-extract-verify cycles when the initial pass does not yield enough verified candidates.

```mermaid
flowchart TD
    subSTART(["START"]) --> assess["assess\nGemini — evaluates results,\ngenerates extraQueries if gaps found"]
    assess -->|"sufficient or budget gone"| subEND(["END"])
    assess -->|"needs more data"| search["search\nBrave Search API\nexecutes extra queries"]
    search --> extract_r["extract_r\nGemini — extracts from\nnew hits only"]
    extract_r --> verify_r["verify_r\nMusicBrainz — verifies\nnew candidates only"]
    verify_r -->|"maxRounds or budget gone"| subEND
    verify_r -->|"rounds remaining"| assess
```

| Node | Model / Service | Description |
|------|----------------|-------------|
| `assess` | Gemini | Evaluates current results; generates `extraQueries` when gaps are found |
| `search` | Brave Search API | Executes extra queries against remaining budget; stores new hits in `newHits` separately from the accumulated `braveHits` |
| `extract_r` | Gemini | Extracts candidates from `newHits` **only** (not all accumulated hits); merges into existing `extractedCandidates` via `mergeExtractedCandidates` |
| `verify_r` | MusicBrainz | Verifies only candidates not yet present in `verifiedCandidates` (by name/canonicalName); merges via `mergeVerifiedCandidates` — preserves all prior-round results |

### Budget management (`researchBudget.ts`)

A shared `ResearchBudget` instance tracks wall-clock time against `RESEARCH_TIMEOUT_MS` (default 45 s — generous because the Brave Search free plan throttles to 1 request/second). Each node calls `budget.allocate(ms)` to claim a per-operation slice. When the budget is exhausted, conditional edges route directly to `END` rather than timing out mid-flight.

---

## External Integrations

| Integration | Used in | Purpose |
|-------------|---------|--------|
| **Brave Search API** | `brave_initial`, `search` | Web discovery for niche and underground artists |
| **Google Gemini** (`@langchain/google-genai`) | `plan`, `extract`, `assess`, `rank` | All structured reasoning and text generation |
| **MusicBrainz** | `verify`, `verify_r` | Artist metadata verification (mbid, genres, tags, URL relations) |
| **Wikidata + Last.fm** | `/artists/image` endpoint, `enrich_lastfm` node | Artist image resolution with Last.fm fallback; similar-artist matches and listener counts feeding the ranker |
| **Anthropic Claude** (optional, key supplied via `MISTRAL_API_KEY` — see note below) | Eval layer | Async LLM-as-Judge scoring — never on the critical path |
| **LangSmith** (optional) | Graph invocation | Distributed tracing for the LangGraph pipeline |

---

## Evaluation layer

An async, non-blocking quality-scoring system that runs after the HTTP response is sent. Full design in [2026-05-29-eval-architecture.md](2026-05-29-eval-architecture.md).

```mermaid
flowchart LR
    RESPONSE[HTTP Response\nsent to user] -->|async · non-blocking| EVAL

    subgraph EVAL [Evaluation Pipeline]
        direction TB
        T1["Tier 1 — Automatic metrics\nobscurity score · funnel counts\nsearch source quality"]
        T15["Tier 1.5 — Deterministic checks\ncitation support rate\ngeneric-why detection"]
        T2["Tier 2 — LLM-as-Judge\nClaude scores each band\nrelevance · obscurity_fit\nevidence_quality · discovery_value"]
        T3["Tier 3 — Human feedback\nimplicit saves · explicit batch reactions"]
        T1 --> T15 --> T2
    end

    EVAL --> DB[(recommendation_events\nllm_eval_scores\nrecommendation_feedback\neval_baselines)]
    T3 --> DB
```

| Tier | Mechanism | When | Signals |
|-------|-----------|------|---------|
| **1 — Automatic metrics** | Runs immediately | After every request | Obscurity score (Last.fm listener count), funnel counts (hits / extracted / verified), search source quality |
| **1.5 — Deterministic checks** | Runs immediately | After every request | Citation support rate (evidence URLs per recommendation), generic-why detection |
| **2 — LLM-as-Judge** | Async, fire-and-forget | When `MISTRAL_API_KEY` is set | Claude scores each band on `relevance`, `obscurity_fit`, `evidence_quality`, `discovery_value` |
| **3 — Human feedback** | Event-driven | User action | Implicit saves + explicit one-tap batch reactions |

Eval data is stored in `recommendation_events`, `llm_eval_scores`, `recommendation_feedback`, and `eval_baselines` tables.

A dashboard at `GET /eval/dashboard` visualizes this data; set `EVAL_DASHBOARD_ENABLED=true` to expose it, and `EVAL_DASHBOARD_PASSWORD` to gate it behind HTTP Basic Auth (recommended whenever the API is publicly reachable — see `.env.example`).

The `services/eval` workspace holds the golden dataset (`golden-set.json`), judge calibration data, and `run-golden.ts`/`run-calibration.ts` runners for evaluating the pipeline offline, outside of live traffic.

> **Note on `MISTRAL_API_KEY`:** despite the variable name, the judge worker (`eval/judgeWorker.ts`) sends this key to Anthropic's API (`claude-opus-4-8`), not Mistral's. The naming is a known mismatch in the code — worth renaming to `ANTHROPIC_API_KEY` in a follow-up, but documented here as the current, actual behavior.

---

## Storage

Two persistence domains, both backed by an abstract repository pattern to allow swapping backends without changing business logic.

### Preferences store (`PREFERENCE_STORE`)

| Backend | Config | Use case |
|---------|--------|----------|
| `sqlite` (default) | `DATABASE_PATH` | Local, zero-config |
| `memory` | — | Ephemeral / testing |
| `postgres` | `DATABASE_URL` | Shared or hosted deployment |
| `turso` | `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` | Cross-device cloud sync |

Tables: `saved_bands` (rating, categories, notes), `artist_groups`

### Session store

SQLite (`bandsearch.db`) with in-memory fallback. Tables: `chat_sessions`, `chat_messages`.

### Auth store

Same backend as preferences. Table: `users` (bcrypt-hashed passwords). JWTs with 30-day expiry; password recovery via single-use recovery codes.

---

## Authentication

Three-tier progressive auth — determined by the number of registered users at runtime:

| Users registered | Mode |
|-----------------|
| 0 | Pass-through — no auth checks |
| 1 | Auto-attach — all requests associated with the single user |
| ≥ 2 | Enforced — `Authorization: Bearer <token>` required for preference endpoints |

---

## Desktop client (`apps/desktop`)

- **Stack:** Tauri (Rust shell) + React (TypeScript)
- **API process:** spawned as a Node.js child process; production builds use a Tauri-bundled Node sidecar
- **Screens:** Welcome, Login, Register, Reset Password, Chat, Saved Artists, Settings (responsive layout via `matchMedia`, breakpoint 767 px), plus supporting UI like `FeedbackReactionBar` (Tier 3 eval feedback) and `ObscurityTargetPicker`
- **API key storage:** OS config directory (`~/.config/bandsearch/config.json` on Linux)

---

## Prompt guards

`agent/promptGuards.ts` wraps all user-controlled content before sending to models — escapes special characters, formats preference context blocks, and structures conversation history to prevent prompt injection. See [ADR 0001](../adr/0001-prompt-injection-guardrails.md) for the design rationale.

---

## Key design decisions

| Decision | Rationale |
|----------|----------|
| **Gemini for all graph nodes** | Consistent structured-JSON output across plan / extract / reflect / rank; low temperature (0.2) for planning reduces variance |
| **Claude as optional async judge** | Keeps the LLM judge off the critical response path; eval can be added/removed without touching the graph |
| **Budget-aware graph** | Hard wall-clock deadline enforced via `researchBudget.ts`; conditional edges bypass remaining nodes gracefully instead of timing out mid-flight |
| **Pluggable storage** | Abstract repository pattern allows SQLite → Postgres → Turso swap without touching business logic |
| **Progressive auth** | Single-user deployments require no configuration; auth activates as users are added |
| **Dedup cache for Brave** | `BraveDedupCache` (Map) prevents redundant API calls within a single recommendation request |
| **Reflection as nested subgraph** | LangGraph subgraph encapsulates the reflection loop's own state and conditional edges cleanly, keeping the main graph linear |
| **Symmetric merge helpers** | `mergeExtractedCandidates` and `mergeVerifiedCandidates` follow the same contract (flat array → deduped array); reused across reflection rounds and as a defensive layer inside `formatEvidenceForPrompt` |
| **Defensive ranker dedup** | `formatEvidenceForPrompt` deduplicates `verifiedCandidates` by `mbid › canonicalName › name` before building the LLM evidence block, regardless of upstream state |

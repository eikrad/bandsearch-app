# Bandsearch

[![CI](https://github.com/eikrad/bandsearch-app/actions/workflows/ci.yml/badge.svg)](https://github.com/eikrad/bandsearch-app/actions/workflows/ci.yml)
![Status: Alpha](https://img.shields.io/badge/status-alpha-orange)
![Version: 0.4.0--alpha.0](https://img.shields.io/badge/version-0.4.0--alpha.0-blue)

AI-powered music recommendations for niche and lesser-known artists.
Combines conversational AI with MusicBrainz metadata and preference memory.

**Recommendation pipeline:** Gemini plans Brave web searches (FFO/Bandcamp-style discovery), extracts candidate band names from snippets, verifies them via MusicBrainz (`lookupArtist` with tags/genres/URL relations), optionally runs up to two reflection rounds (each processes only the new hits from that round and accumulates candidates across rounds), then ranks picks with evidence-grounded `why` text. `BRAVE_API_KEY` is required at startup — there is no fallback.

```mermaid
flowchart TD
    START(["START"]) --> plan["plan\nWebSearchPlanner · Gemini"]
    plan --> brave_initial["brave_initial\nBrave Search API"]
    brave_initial --> extract["extract\nCandidateExtractor · Gemini"]
    extract --> verify["verify\nMusicBrainz"]
    verify --> reflect_if_needed

    subgraph reflect_if_needed["reflect_if_needed — Reflection Subgraph"]
        direction TD
        subSTART(["START"]) --> assess["assess\nRecommendationReflector · Gemini"]
        assess -- "sufficient or budget gone" --> subEND(["END"])
        assess -- "needs more data" --> search["search\nBrave Search API"]
        search --> extract_r["extract_r\nCandidateExtractor · Gemini"]
        extract_r --> verify_r["verify_r\nMusicBrainz"]
        verify_r -- "maxRounds or budget gone" --> subEND
        verify_r -- "loop" --> assess
    end

    reflect_if_needed --> rank["rank\nRecommendationRanker · Gemini"]
    rank --> END(["END"])
```

See [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) for a full description of all nodes, state fields, and design decisions.

---

## Quick Start

**Prerequisites:** Node.js 22+

```bash
git clone https://github.com/eikrad/bandsearch-app
cd bandsearch-app
npm install
cp .env.example .env        # then add GEMINI_API_KEY and BRAVE_API_KEY
npm run dev                 # API starts on http://localhost:3001
```

Preferences are saved automatically to `bandsearch.db` — no database setup needed.
Both `GEMINI_API_KEY` and `BRAVE_API_KEY` are required to start the API.

Test it:

```bash
curl -X POST http://localhost:3001/recommendations \
  -H "content-type: application/json" \
  -d '{"query": "I like Alcest and Agalloch"}'
```

---

## Desktop App (Tauri)

**Additional prerequisites:** [Rust](https://rustup.rs) + platform build tools (see below)

```bash
npm run desktop             # opens native window, starts API automatically
```

### Platform prerequisites

**Linux:**
```bash
# Arch / Manjaro
sudo pacman -S webkit2gtk-4.1 libappindicator-gtk3 librsvg

# Debian / Ubuntu
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

**macOS:** Xcode Command Line Tools (`xcode-select --install`). No additional packages needed.

**Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **Desktop development with C++** workload. WebView2 is built into Windows 10 1803+ and Windows 11 — no manual install needed.

### How the API server is launched

The desktop app spawns a Node.js API server as a child process. In development it uses the system `node` on your `PATH`. In a production bundle (`tauri build`), it looks for a Tauri-bundled Node sidecar placed next to the executable — named `node-<target-triple>[.exe]` — and prefers that over the system node. If no sidecar is present, it falls back to system `node` automatically.

To produce a production build you must place the correct Node binary in `apps/desktop/src-tauri/binaries/` before running `tauri build`. See `apps/desktop/src-tauri/binaries/README` for the naming convention and download instructions.

### API key storage

Keys are written to the OS config directory as `bandsearch/config.json`:

| OS | Path |
|----|------|
| Linux | `~/.config/bandsearch/config.json` |
| macOS | `~/Library/Application Support/bandsearch/config.json` |
| Windows | `%APPDATA%\bandsearch\config.json` |

**First launch:** A welcome screen (`#/welcome`) explains that a Gemini key is needed and links to Settings. Use **Settings** in the app header (or `#/settings`) to save your Gemini and Brave keys. The Tauri shell passes both keys to the Node API process and restarts it after you save.

If a recommendation call fails (rate limit, unreachable API, or Gemini errors), the chat view shows a banner with a short, human-readable hint instead of failing silently.

---

## Authentication

Bandsearch uses optional local multi-user auth (bcrypt + 30-day JWT).

**Single-user bypass (default):** When no users are registered the API runs open with no auth checks — ideal for local single-user setups. Auth is enforced only once you register the first account.

| Users registered | Behaviour |
|-----------------|----------|
| 0 | Pass-through — all requests accepted, no token needed |
| 1 | Auto-attach — requests are automatically associated with the single user |
| ≥ 2 | Enforced — `Authorization: Bearer <token>` required for preference endpoints |

**Registration:** `POST /auth/register` returns a JWT token and a **recovery code**. Store the recovery code safely — it is the only way to reset your password. Tokens expire after 30 days.

**Recovery:** `POST /auth/reset-password` accepts the recovery code and issues a new code. The old code is invalidated immediately.

**JWT secret:** Set `JWT_SECRET` in your environment for persistent sessions. Without it, a random secret is generated on startup and all tokens are invalidated on restart.

The desktop client persists the token in browser storage and injects it as `Authorization: Bearer` on every API call. The login/register/reset-password screens are shown automatically on startup when the API requires authentication.

---

## Storage

Bandsearch uses two persistence domains:

- **Preferences store** (`saved_bands`, groups) — configurable via `PREFERENCE_STORE`.
- **Session store** (`chat_sessions`, `chat_messages`) — local SQLite in `DATABASE_PATH` (default `bandsearch.db`), with in-memory fallback if SQLite is unavailable.

| `PREFERENCE_STORE` | Description |
|--------------------|-------------|
| `sqlite` (default) | Local file, zero-config, data survives restarts |
| `memory` | In-process only, data lost on restart |
| `postgres` | Postgres/Supabase, requires `DATABASE_URL` |
| `turso` | Turso/libSQL cloud SQLite, requires `TURSO_DATABASE_URL` — enables cross-device sync |

**Postgres setup:**

```bash
# in .env:
PREFERENCE_STORE=postgres
DATABASE_URL=postgres://user:pass@host/dbname

npm run migrate
npm run dev
```

**Turso setup:**

```bash
# Install the Turso CLI and create a database:
#   turso db create bandsearch
#   turso db show bandsearch --url
#   turso db tokens create bandsearch

# in .env:
PREFERENCE_STORE=turso
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your_turso_auth_token_here

TURSO_DATABASE_URL=libsql://your-db.turso.io TURSO_AUTH_TOKEN=your_token npm run migrate:turso
npm run dev
```

Turso URL and auth token can also be saved through the **Settings** screen in the desktop app; the API restarts automatically with the new credentials.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API port |
| `GEMINI_API_KEY` | — | **Required** — API will not start without it |
| `BRAVE_API_KEY` | — | **Required** — Brave Search token (`X-Subscription-Token`) |
| `JWT_SECRET` | *(auto-generated)* | Signing secret for JWT tokens; set for persistent sessions across restarts |
| `PREFERENCE_STORE` | `sqlite` | `sqlite`, `memory`, `postgres`, or `turso` |
| `DATABASE_PATH` | `bandsearch.db` | SQLite file path |
| `DATABASE_URL` | — | Required when `PREFERENCE_STORE=postgres` |
| `DATABASE_SSL` | `true` | TLS for Postgres connection |
| `TURSO_DATABASE_URL` | — | Required when `PREFERENCE_STORE=turso` |
| `TURSO_AUTH_TOKEN` | — | Turso auth token (omit for local libSQL) |
| `CORS_ORIGIN` | `*` | Allowed browser origin |
| `RECOMMENDATION_TIMEOUT_MS` | `8000` | Gemini request timeout |
| `RECOMMENDATION_PIPELINE_READY_TIMEOUT_MS` | `45000` | Max wait before HTTP listen while the pipeline initializes |
| `MUSICBRAINZ_TIMEOUT_MS` | `5000` | MusicBrainz request timeout |
| `MUSICBRAINZ_RETRIES` | `1` | MusicBrainz retry attempts |
| `LASTFM_API_KEY` | — | Optional — Last.fm fallback for artist images and obscurity scoring (listener counts) |
| `MISTRAL_API_KEY` | — | Optional — activates the async LLM-as-judge eval worker (Mistral scores recommendations after the response is sent)
| `EVAL_DASHBOARD_ENABLED` | — | Set `true` to enable the developer eval dashboard at `/eval/dashboard` |
| `LANGSMITH_API_KEY` | — | Optional LangSmith tracing |
| `LANGSMITH_TRACING` | — | Set `true` to enable tracing |
| `LANGSMITH_PROJECT` | — | LangSmith project name |
| `RESEARCH_MAX_INITIAL_SEARCHES` | `6` | Max Brave queries on first pass |
| `RESEARCH_MAX_REFLECTION_SEARCHES` | `4` | Cap on extra queries after reflection |
| `RESEARCH_TOTAL_SEARCH_BUDGET` | `10` | Max Brave calls per recommendation request |
| `RESEARCH_TIMEOUT_MS` | `25000` | Upper bound for the multi-step research workflow |
| `RESEARCH_TARGET_VERIFIED_CANDIDATES` | `8` | Verified MusicBrainz hits before skipping reflection |

---

## API Reference

### Core

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service health probe |
| `GET` | `/version` | Returns app version |

### Auth

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/auth/status` | Returns `{ enabled, userCount }` — always public |
| `POST` | `/auth/register` | Register; returns `{ user, token, recoveryCode }` |
| `POST` | `/auth/login` | Login; returns `{ user, token }` |
| `POST` | `/auth/reset-password` | Reset password with recovery code; returns `{ newRecoveryCode }` |

### Recommendations

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/recommendations` | Generate recommendations (`fresh` or `preference-aware` mode) |

Request body example:

```json
{
  "query": "I like Alcest and Agalloch",
  "mode": "preference-aware",
  "selectedArtistIds": ["mbid-1", "mbid-2"],
  "priorityContext": "Prefer dreamy blackgaze and long tracks",
  "messages": [
    { "role": "user", "content": "I like Alcest" },
    { "role": "assistant", "content": "Try Fen and Les Discrets" }
  ]
}
```

Response includes `recommendations`, optional `assistantReply` (conversational prose from the model), and `meta` (`modeUsed`, `usedPreferenceContext`).

### Preferences

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/preferences` | Save a band |
| `GET` | `/preferences` | List saved bands |
| `PATCH` | `/preferences/:id` | Update rating / categories / note |
| `DELETE` | `/preferences/:id` | Remove a band |
| `GET` | `/preferences/context` | Render AI context string from saved bands |
| `GET` | `/preferences/export` | Export all saved bands as JSON |
| `POST` | `/preferences/import` | Import saved bands from JSON array; returns `{ imported, skipped, failed }` |

### Artist Groups

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/preferences/groups` | List all groups with member IDs |
| `POST` | `/preferences/groups` | Create a group |
| `POST` | `/preferences/groups/auto` | Auto-generate groups by genre (MusicBrainz tags) |
| `PATCH` | `/preferences/groups/:id` | Rename a group |
| `DELETE` | `/preferences/groups/:id` | Delete a group |
| `POST` | `/preferences/groups/:id/artists` | Add artist to group |
| `DELETE` | `/preferences/groups/:id/artists/:savedBandId` | Remove artist from group |

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sessions` | Create chat session |
| `GET` | `/sessions` | List chat sessions |
| `GET` | `/sessions/:id` | Get one session with messages |
| `POST` | `/sessions/:id/messages` | Add message to session |

### Artist Discovery

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/artists/search?query=...` | Search artists via MusicBrainz |
| `GET` | `/artists/image?name=...` | Resolve artist image URL (Wikidata + Last.fm fallback) |

### Eval

Requires `EVAL_DASHBOARD_ENABLED=true` in the environment.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/eval/dashboard` | Developer quality dashboard — pipeline funnel, obscurity distribution, LLM-judge alignment, trend charts, and event log |
| `POST` | `/eval/baseline` | Save a named snapshot of current aggregated metrics for before/after comparison |

---

## Development

```bash
npm test          # run all workspace tests
npm run ci        # lint + typecheck + test
```

The API, shared schema, and **desktop** workspaces run tests with **tsx** so `.ts` sources execute next to remaining `.js` modules. `npm run dev` / `npm start` also use tsx for the API entrypoint.

`npm run ci` runs **ruff** and **black** on Python sources (same as GitHub Actions). `npm run lint:py` uses `scripts/lint-py.sh`, which prefers a repo-local **`.venv`** (`python3 -m venv .venv && .venv/bin/pip install ruff black`) and falls back to tools on your `PATH`. The `.venv/` directory is gitignored.

Tests run automatically before every commit via a pre-commit hook (installed by `npm install`).

**CI** runs on both `ubuntu-latest` and `windows-latest` via a GitHub Actions matrix. All `run:` steps use Bash (Git Bash on Windows) so shell scripts like `lint-py.sh` work cross-platform without modification.

---

## Monorepo Structure

```
apps/desktop/     — Tauri + React desktop client
services/api/     — Express API
services/eval/    — golden dataset and eval runner (anti-band gate, nugget coverage)
shared/schemas/   — shared validation contracts (TypeScript contracts.ts + tests)
docs/             — architecture docs, ADRs, design specs, roadmap
```

In development (browser or embedded webview), the chat UI chooses **mobile vs desktop layout** from window width (`matchMedia`, max-width **767px**), so you do not need to pass a `viewport` option manually when resizing the window.

## Acknowledgements

- [MusicBrainz](https://musicbrainz.org) — open music encyclopedia providing artist and release metadata. Data used under the [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) licence.
- [Google Gemini](https://deepmind.google/technologies/gemini/) — large language model powering the recommendation and explanation layer.
- [LangChain](https://www.langchain.com) — framework used to structure and invoke the Gemini model calls.
- [Tauri](https://tauri.app) — framework for building the native desktop wrapper around the web UI.
- [Brave Search](https://brave.com/search/api/) — web search API used for niche artist discovery.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).

# Bandsearch

[![CI](https://github.com/eikrad/bandsearch-app/actions/workflows/ci.yml/badge.svg)](https://github.com/eikrad/bandsearch-app/actions/workflows/ci.yml)
![Status: Alpha](https://img.shields.io/badge/status-alpha-orange)
![Version: 0.3.0--alpha.1](https://img.shields.io/badge/version-0.3.0--alpha.1-blue)

AI-powered music recommendations for niche and lesser-known artists.
Combines conversational AI with MusicBrainz metadata and preference memory.

---

## Quick Start

**Prerequisites:** Node.js 20+

```bash
git clone https://github.com/eikrad/bandsearch-app
cd bandsearch-app
npm install
cp .env.example .env        # then add your GEMINI_API_KEY
npm run dev                 # API starts on http://localhost:3001
```

Preferences are saved automatically to `bandsearch.db` — no database setup needed.
`GEMINI_API_KEY` is required to start the API (including local development).

Test it:

```bash
curl -X POST http://localhost:3001/recommendations \
  -H "content-type: application/json" \
  -d '{"query": "I like Alcest and Agalloch"}'
```

---

## Desktop App (Tauri)

**Additional prerequisites:** [Rust](https://rustup.rs) + Linux system deps (see below)

```bash
npm run desktop             # opens native window, starts API automatically
```

**Linux system dependencies:**

```bash
# Arch / Manjaro
sudo pacman -S webkit2gtk-4.1 libappindicator-gtk3 librsvg

# Debian / Ubuntu
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

**Gemini API key (desktop):** Use **Settings** in the app header (or open `#/settings`) to save your key. It is written to the OS config directory as `bandsearch/config.json` (e.g. `~/.config/bandsearch/config.json` on Linux). The Tauri shell passes `GEMINI_API_KEY` to the bundled Node API process and restarts that process after you save. It also sets **`DATABASE_PATH`** to an absolute `bandsearch.db` next to the repo root (resolved from the app binary), so preference SQLite storage does not depend on the OS current working directory. Developers can still use a workspace `.env` file; when present, the usual API startup behavior applies (dotenv does not override variables already set when the process starts).

---

## Storage

Bandsearch currently uses two persistence domains:

- **Preferences store** (`saved_bands`) — configurable via `PREFERENCE_STORE`.
- **Session store** (`chat_sessions`, `chat_messages`) — currently local SQLite in `DATABASE_PATH` (default `bandsearch.db`), with in-memory fallback if SQLite is unavailable.

Preferences are persisted by default in a local SQLite file (`bandsearch.db`) — no server or configuration required.

| `PREFERENCE_STORE` | Description |
|--------------------|-------------|
| `sqlite` (default) | Local file, zero-config, data survives restarts |
| `memory` | In-process only, data lost on restart |
| `postgres` | Postgres/Supabase, requires `DATABASE_URL` |
| `turso` | Turso/libSQL cloud SQLite, requires `TURSO_DATABASE_URL` |

### Session persistence

Session and chat message history is stored in local SQLite tables created automatically by the API:

- `chat_sessions`
- `chat_messages`

No separate migration step is required for these session tables; they are created on startup if missing.

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

npm run migrate
npm run dev
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API port |
| `GEMINI_API_KEY` | — | Required — API will not start without it |
| `PREFERENCE_STORE` | `sqlite` | `sqlite`, `memory`, `postgres`, or `turso` |
| `DATABASE_PATH` | `bandsearch.db` | SQLite file path |
| `DATABASE_URL` | — | Required when `PREFERENCE_STORE=postgres` |
| `DATABASE_SSL` | `true` | TLS for Postgres connection |
| `TURSO_DATABASE_URL` | — | Required when `PREFERENCE_STORE=turso` |
| `TURSO_AUTH_TOKEN` | — | Turso auth token (omit for local libSQL) |
| `CORS_ORIGIN` | `*` | Allowed browser origin |
| `RECOMMENDATION_TIMEOUT_MS` | `8000` | Gemini request timeout |
| `RECOMMENDATION_PIPELINE_READY_TIMEOUT_MS` | `45000` | Max wait before HTTP listen while the recommendation pipeline initializes (non-blocking cap) |
| `MUSICBRAINZ_TIMEOUT_MS` | `5000` | MusicBrainz request timeout |
| `MUSICBRAINZ_RETRIES` | `1` | MusicBrainz retry attempts |
| `LASTFM_API_KEY` | — | Optional — Last.fm helper for artist images (via validated runtime config) |
| `LANGSMITH_API_KEY` | — | Optional LangSmith tracing |
| `LANGSMITH_TRACING` | — | Set `true` to enable tracing |
| `LANGSMITH_PROJECT` | — | LangSmith project name |

---

## API Reference

### Core

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service health probe |
| `GET` | `/version` | Returns app version |

### Recommendations

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/recommendations` | Generate recommendations with `fresh` (default) or `preference-aware` mode |

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

Response includes `recommendations`, optional **`assistantReply`** (short conversational text from the model: acknowledgement + suggested next step), and `meta` (`modeUsed`, `usedPreferenceContext`).

### Preferences

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/preferences` | Save a band |
| `GET` | `/preferences` | List saved bands |
| `PATCH` | `/preferences/:id` | Update rating / categories / note |
| `DELETE` | `/preferences/:id` | Remove a band |
| `GET` | `/preferences/context` | Render AI context string from saved bands |

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
| `GET` | `/artists/search?query=...` | Search artists (canonical) |
| `GET` | `/search/artists?q=...` | Same behavior as `/artists/search` (legacy query param `q`) |
| `GET` | `/artists/image?name=...` | Resolve artist image URL |

---

## Development

```bash
npm test          # run all workspace tests
npm run ci        # lint + typecheck + test
```

The API and shared schema workspaces run tests with **tsx** so `.ts` sources execute next to existing `.js` modules (`npm run dev` / `npm start` use tsx for the API entrypoint as well).

`npm run ci` runs **ruff** and **black** on Python sources (same as GitHub Actions). If those commands are missing locally, create a venv and install them: `python3 -m venv .venv && .venv/bin/pip install ruff black`, then run `npm run ci` with `.venv/bin` on your `PATH` (the `.venv/` directory is gitignored).

Tests run automatically before every commit via a pre-commit hook (installed by `npm install`).

---

## Monorepo Structure

```
apps/desktop/     — Tauri + React desktop client
services/api/     — Express API
shared/schemas/   — shared validation contracts (TypeScript `contracts.ts` + tests)
docs/             — roadmap and design specs
```

In development (browser or embedded webview), the chat UI chooses **mobile vs desktop layout** from window width (`matchMedia`, max-width **767px**), so you do not need to pass a `viewport` option manually when resizing the window.

## Acknowledgements

- [MusicBrainz](https://musicbrainz.org) — open music encyclopedia providing artist and release metadata. Data used under the [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) licence.
- [Google Gemini](https://deepmind.google/technologies/gemini/) — large language model powering the recommendation and explanation layer.
- [LangChain](https://www.langchain.com) — framework used to structure and invoke the Gemini model calls.
- [Tauri](https://tauri.app) — framework for building the native desktop wrapper around the web UI.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).

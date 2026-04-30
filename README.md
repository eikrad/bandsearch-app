# Bandsearch

[![CI](https://github.com/eikrad/bandsearch-app/actions/workflows/ci.yml/badge.svg)](https://github.com/eikrad/bandsearch-app/actions/workflows/ci.yml)
![Status: Alpha](https://img.shields.io/badge/status-alpha-orange)
![Version: 0.2.0--alpha.1](https://img.shields.io/badge/version-0.2.0--alpha.1-blue)

AI-powered music recommendations for niche and lesser-known artists.
Combines conversational AI with MusicBrainz metadata and preference memory.

---

## Quick Start

**Prerequisites:** Node.js 20+, a [Gemini API key](https://aistudio.google.com/app/apikey)

```bash
git clone https://github.com/eikrad/bandsearch-app
cd bandsearch-app
npm install
cp .env.example .env        # then add your GEMINI_API_KEY
npm run dev                 # API starts on http://localhost:3001
```

Preferences are saved automatically to `bandsearch.db` — no database setup needed.

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

---

## Storage

Preferences are persisted by default in a local SQLite file (`bandsearch.db`) — no server or configuration required.

| `PREFERENCE_STORE` | Description |
|--------------------|-------------|
| `sqlite` (default) | Local file, zero-config, data survives restarts |
| `memory` | In-process only, data lost on restart |
| `postgres` | Postgres/Supabase, requires `DATABASE_URL` |

**Postgres setup:**

```bash
# in .env:
PREFERENCE_STORE=postgres
DATABASE_URL=postgres://user:pass@host/dbname

npm run migrate
npm run dev
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API port |
| `GEMINI_API_KEY` | — | Required for AI recommendations |
| `PREFERENCE_STORE` | `sqlite` | `sqlite`, `memory`, or `postgres` |
| `DATABASE_PATH` | `bandsearch.db` | SQLite file path |
| `DATABASE_URL` | — | Required when `PREFERENCE_STORE=postgres` |
| `DATABASE_SSL` | `true` | TLS for Postgres connection |
| `CORS_ORIGIN` | `*` | Allowed browser origin |
| `RECOMMENDATION_TIMEOUT_MS` | `8000` | Gemini request timeout |
| `MUSICBRAINZ_TIMEOUT_MS` | `5000` | MusicBrainz request timeout |
| `MUSICBRAINZ_RETRIES` | `1` | MusicBrainz retry attempts |
| `LANGSMITH_API_KEY` | — | Optional LangSmith tracing |
| `LANGSMITH_TRACING` | — | Set `true` to enable tracing |
| `LANGSMITH_PROJECT` | — | LangSmith project name |

---

## API Reference

### Recommendations

`POST /recommendations`
```json
{ "query": "I like Alcest and Agalloch", "mode": "fresh" }
```

`mode`: `fresh` (default) or `preference-aware` — passes your saved bands as context to the AI model.

### Preferences

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/preferences` | Save a band |
| `GET` | `/preferences` | List saved bands |
| `PATCH` | `/preferences/:id` | Update rating / categories / note |
| `DELETE` | `/preferences/:id` | Remove a band |
| `GET` | `/preferences/context` | AI context string |

---

## Development

```bash
npm test          # run all workspace tests (67 tests)
npm run ci        # lint + typecheck + test
```

Tests run automatically before every commit via a pre-commit hook (installed by `npm install`).

---

## Monorepo Structure

```
apps/desktop/     — Tauri + React desktop client
services/api/     — Express API
shared/schemas/   — shared validation contracts
docs/             — roadmap and design specs
```

## License

Apache 2.0 — see [LICENSE](LICENSE).

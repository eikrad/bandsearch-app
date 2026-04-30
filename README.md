# Bandsearch

[![CI](https://github.com/eikrad/bandsearch-app/actions/workflows/ci.yml/badge.svg)](https://github.com/eikrad/bandsearch-app/actions/workflows/ci.yml)
![Status: Alpha](https://img.shields.io/badge/status-alpha-orange)
![Version: 0.2.0--alpha.1](https://img.shields.io/badge/version-0.2.0--alpha.1-blue)

Bandsearch is an AI-powered music recommendation app for niche and lesser-known artists.
It combines conversational AI with MusicBrainz metadata and preference memory.

Current release stage: **alpha**.

## Monorepo Structure

- `apps/desktop` - desktop app (Tauri + React shell)
- `services/api` - Node.js/Express API
- `shared/schemas` - shared API and domain schemas
- `docs/ROADMAP.md` - product and technical roadmap

## Quick Start (API)

```bash
npm install
cp .env.example .env
## optional for Postgres:
## set PREFERENCE_STORE=postgres and DATABASE_URL in .env
## npm run migrate --workspace @bandsearch/api
node services/api/src/server.js
```

Default port: `3001` (configurable via `PORT`).

### Environment Variables

- `PORT`: API port (default `3001`)
- `GEMINI_API_KEY`: required for LangChain + Gemini recommendations
- `LANGSMITH_API_KEY`: optional but recommended for tracing
- `LANGSMITH_TRACING`: set `true` to enable tracing
- `LANGSMITH_PROJECT`: LangSmith project name
- `CORS_ORIGIN`: allowed web origin for browser clients
- `RECOMMENDATION_TIMEOUT_MS`: model request timeout in milliseconds
- `MUSICBRAINZ_TIMEOUT_MS`: MusicBrainz request timeout in milliseconds
- `MUSICBRAINZ_RETRIES`: retry attempts for MusicBrainz requests
- `PREFERENCE_STORE`: `memory` (default) or `postgres`
- `DATABASE_URL`: required when `PREFERENCE_STORE=postgres`
- `DATABASE_SSL`: `true`/`false` for Postgres TLS mode

## API Hardening (Current)

- Security middleware: `helmet`, `cors`, request body limit (`32kb`)
- Abuse protection: rate limit on `POST /recommendations` (30 requests/minute per IP)
- Reliability: outbound timeout/retry for MusicBrainz and timeout for model calls
- Error contract: structured error payloads (`error.code`, `error.message`) across endpoints
- Observability: JSON request logging with request IDs and response timings

## Persistence

Saved preferences are currently stored in-memory. Data is reset on API restart and not yet persisted to a database.
The API now uses a `PreferenceRepository` abstraction so a database-backed implementation can be plugged in without changing route contracts.
If `PREFERENCE_STORE=postgres`, preferences are stored in Postgres using the migration in `services/api/migrations/001_create_saved_bands.sql`.

### Postgres Setup

```bash
cp .env.example .env
# set PREFERENCE_STORE=postgres and DATABASE_URL in .env
npm run migrate --workspace @bandsearch/api
node services/api/src/server.js
```

## API Reference

### System

- `GET /health`
  - Purpose: simple liveness check (`{ "status": "ok" }`)

- `GET /version`
  - Purpose: returns the current app version from `package.json`

### Recommendations

- `POST /recommendations`
  - Purpose: returns band recommendations
  - Body:
    - `query` (string, required)
    - `mode` (`fresh` or `preference-aware`, optional; default `fresh`)
  - Response:
    - `recommendations[]` with `artist`, `why`, `sourceSignals[]`
    - `meta.modeUsed`
    - `meta.usedPreferenceContext`
  - Note: when no MusicBrainz artists are found, the API returns deterministic query-based fallback recommendations.

Example:

```json
{
  "query": "I like Alcest and Agalloch",
  "mode": "preference-aware"
}
```

### Preferences (Saved Bands)

- `POST /preferences`
  - Purpose: stores a band preference
  - Body:
    - `musicbrainzArtistId` (string)
    - `name` (string)
    - `rating` (int 1-5)
    - `categories` (string[])
    - `note` (string)

- `GET /preferences`
  - Purpose: lists all saved bands

- `PATCH /preferences/:id`
  - Purpose: updates `rating`, `categories`, `note`

- `DELETE /preferences/:id`
  - Purpose: deletes a saved entry

- `GET /preferences/context`
  - Purpose: returns condensed preference context for `preference-aware` search

## Shared Contracts

- Shared validation contracts live in `shared/schemas/src/contracts.js`.
- Currently centralized:
  - recommendation item validation
  - saved band validation
  - recommendation mode normalization (`fresh` / `preference-aware`)
- The API and tests already use these contracts so backend and frontend can share the same data contract.

## CI Quality Gates

CI runs via `.github/workflows/ci.yml` and executes:
- JavaScript linting (ESLint)
- Python lint/format checks (Ruff + Black)
- Type checks (`tsc --noEmit`)
- Workspace tests (`node --test`)

## License

This project is licensed under Apache License 2.0. See `LICENSE`.

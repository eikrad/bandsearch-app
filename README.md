# Bandsearch

Bandsearch is an AI-powered music recommendation app focused on niche bands and lesser-known artists.
This repository is structured as a monorepo for the Tauri desktop client, the API, and shared schemas.

## Current Status

- Phase 0 foundation is complete: repository structure, CI baseline, Apache-2.0 license.
- Phase 1 is in progress: recommendation core with MusicBrainz + LangChain + Gemini.

## Monorepo Structure

- `apps/desktop` - desktop app (Tauri + React, placeholder in Phase 0)
- `services/api` - Node.js/Express API
- `shared/schemas` - shared API and domain schemas
- `docs/ROADMAP.md` - product and technical roadmap

## Local Start (API)

```bash
npm install
node services/api/src/server.js
```

Default port: `3001` (configurable via `PORT`).

## API Reference (Current)

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

## CI

CI runs via `.github/workflows/ci.yml` and currently executes lint, typecheck, and tests across all workspaces.

## License

This project is licensed under Apache License 2.0. See `LICENSE`.

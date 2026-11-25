# Running and hosting the API

How to configure, host and operate the Bandsearch API: configuration,
storage, authentication, the closed-beta admin commands, Render, and the
privacy duties a deployment carries. Local development is in
[development.md](development.md); the design behind each part is in
[architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md).

## Configuration

All variables, with comments, are in [`.env.example`](../.env.example).
Required:

| Variable | Description |
|----------|-------------|
| `SCW_SECRET_KEY` | Scaleway Generative APIs, the only LLM provider; also enables the LLM judge |
| `BRAVE_API_KEY` | Brave Search, for finding candidate bands on the web |

Common optional variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `SCW_MODEL` | `deepseek-v4-flash-0731` | Research model ([ADR 0004](adr/0004-llm-models-per-role-on-scaleway.md)) |
| `SCW_JUDGE_MODEL` | `gemma-4-26b-a4b-it` | LLM-as-judge model; must differ from the research model |
| `SCW_REASONING_EFFORT` / `SCW_JUDGE_REASONING_EFFORT` | `none` | Scaleway reasoning per role; `none` keeps calls fast. `gpt-oss-120b` needs `low` or higher |
| `SCW_BASE_URL` | `https://api.scaleway.ai/v1` | Project-scoped Scaleway endpoint, if you use one |
| `LLM_PROVIDER` | `scaleway` | `scaleway` is the only accepted value |
| `PORT` | `3001` | API port |
| `AUTH_MODE` | `progressive` | `enforced` closes the deployment ([Authentication](#authentication)) |
| `JWT_SECRET` | random, in memory | Set it so sessions survive a restart; required when `AUTH_MODE=enforced` |
| `REGISTRATION_OPEN` | `true` | `false` rejects every `POST /auth/register` |
| `PREFERENCE_STORE` | `sqlite` | `sqlite`, `memory`, `turso` or `turso-sync` ([Storage](#storage)) |
| `DATABASE_PATH` | `bandsearch.db` | SQLite file |
| `LASTFM_API_KEY` | — | Last.fm: similar artists, listener counts, tags, biographies, image fallback |
| `LANGSMITH_API_KEY` | — | LangSmith tracing |
| `RESEARCH_TIMEOUT_MS` | `180000` | Deadline for one search, ranking included; ranking keeps up to 20 s of it |
| `RESEARCH_TARGET_VERIFIED_CANDIDATES` | `8` | Verified bands wanted before reflection stops |
| `RESEARCH_MAX_INITIAL_SEARCHES` / `RESEARCH_MAX_REFLECTION_SEARCHES` / `RESEARCH_TOTAL_SEARCH_BUDGET` | `6` / `4` / `10` | Brave search caps for the first pass, for reflection, and in total |
| `CORS_ORIGIN` | `*` (`.env.example` sets `http://localhost:1420`) | Allowed browser origin |
| `EVAL_DASHBOARD_ENABLED` | `false` | Records eval telemetry and exposes `/eval/*` |
| `EVAL_DASHBOARD_PASSWORD` | — | HTTP Basic Auth for `GET /eval/dashboard` |
| `EVAL_RETENTION_DAYS` | `90` | How long recommendation events are kept |

## Storage

`PREFERENCE_STORE` selects the database for **all** account data, despite its
name: saved bands, artist groups, users, invites, chat sessions and
recommendation feedback. Account export and deletion cover that one database.
If the selected backend cannot be opened, the server refuses to start rather
than falling back to another store.

| `PREFERENCE_STORE` | Description |
|--------------------|-------------|
| `sqlite` (default) | Local file (`DATABASE_PATH`), zero-config |
| `memory` | In-process only, lost on restart; account export and deletion report unavailable |
| `turso` | Turso cloud database (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`); every statement goes over the network |
| `turso-sync` | Local replica (`TURSO_SYNC_PATH`) synced with Turso Cloud; reads and writes stay local, so it keeps working offline |

Eval telemetry never lives on Turso: with `EVAL_DASHBOARD_ENABLED=true` it goes
to the local SQLite file at `DATABASE_PATH`, otherwise nothing is recorded.
Recommendation feedback (`POST /recommendations/:eventId/feedback`) is account
data, works with the dashboard off, takes its owner from the authenticated
identity and is kept for 90 days.

For a Turso database, run the migrations once:

```bash
TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run migrate:turso --workspace @bandsearch/api
```

## Authentication

Local accounts (bcrypt passwords, 30-day JWTs) in one of two modes, chosen by
`AUTH_MODE`.

### `progressive` (default, personal installs)

| Users registered | Behaviour |
|------------------|-----------|
| 0 | Pass-through: every request is accepted without a token |
| 1 | Auto-attach: requests belong to the single user, even without a valid token |
| ≥ 2 | `Authorization: Bearer <token>` required for preference endpoints |

Anyone who can reach the URL can register. Do not expose this mode to the
internet.

### `enforced` (closed beta, set by `render.yaml`)

For a hosted deployment with a known set of testers
([ADR 0005](adr/0005-closed-beta-via-email-bound-invites.md)):

- Every protected request needs a valid token for a user that exists and is not
  disabled. `/artists/*` is protected too; `/health`, `/version` and `/auth/*`
  stay public.
- `JWT_SECRET` is required; the server refuses to start without it.
- `POST /auth/register` needs an `inviteCode`: bound to one email address,
  single-use, valid for 14 days. Any invalid code gets the same
  `403 invite_invalid`. The email address is **not verified**; the code is the
  secret, and the binding makes a forwarded code useless to anyone else.
- `GET /auth/status` reports `authMode` and `inviteRequired`; the app shows an
  invite-code field accordingly.

In both modes, `/auth/register`, `/auth/login` and `/auth/reset-password` are
limited to 20 requests per 15 minutes per client IP, and
`REGISTRATION_OPEN=false` closes registration completely. Registering returns a
token and a **recovery code**, the only way to reset a forgotten password.

### Administering a closed beta

There is no admin UI or endpoint: the admin is whoever holds the database
credentials. The commands use the same database as the server (Turso when
`PREFERENCE_STORE` is `turso` or `turso-sync`, otherwise the local SQLite file):

```bash
npm run invite:create --workspace @bandsearch/api -- --email tester@example.com [--days 14]   # prints the code once
npm run invite:list   --workspace @bandsearch/api
npm run invite:revoke --workspace @bandsearch/api -- --email tester@example.com
npm run user:disable  --workspace @bandsearch/api -- --email tester@example.com   # locks them out on their next request
npm run user:enable   --workspace @bandsearch/api -- --email tester@example.com
npm run feedback:list --workspace @bandsearch/api -- [--days 7] [--json]       # what testers said about their recommendations
```

Only the SHA-256 hash of an invite code is stored, so a lost code cannot be
shown again: revoke it and issue a new one. `feedback:list` prints the
recommendation feedback of the last N days (7 by default) with the tester's
address, the query, mode, obscurity target and the bands shown; `--json` gives
the rows for a script.

## Hosting on Render

`render.yaml` configures a [Render](https://render.com) Web Service
(`bandsearch-api`, Node, Frankfurt, free plan, `npm start`, health check
`/health`) that deploys from `main`, with `PREFERENCE_STORE=turso`,
`AUTH_MODE=enforced` and the eval dashboard off. Render takes the Node version
from `.nvmrc`.

1. Create a Turso database and run `npm run migrate:turso` against it (above).
2. Set the secrets in the Render dashboard (they are not synced from
   `render.yaml`): `SCW_SECRET_KEY` (a key of its own), `BRAVE_API_KEY`,
   `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `JWT_SECRET`.
3. Create your first invite (`npm run invite:create`, with the Turso variables
   set) and register with it.
4. In the desktop app, set the API endpoint in Settings to the deployed URL.

**Free-plan limits:** the service spins down after 15 minutes without traffic,
so the first request after a pause can take 30–60 seconds, and there is no SLA.
The desktop app wakes a hosted API when the user comes back and keeps it awake
while the app is in use. The Starter plan removes the cold start
([ADR 0003](adr/0003-android-hosting-render-over-fly.md) explains why the
project stays on the free plan for now).

Search jobs live in the server's memory: a restart or redeploy loses running
searches, and the app then reports the search as lost and offers Retry
([ADR 0006](adr/0006-search-jobs-survive-the-client.md)).

## Privacy and transparency

Bandsearch is a minimal-risk AI system under the EU AI Act, and the
transparency duty in Art. 50 applies to it. The chat composer permanently
states that an EU-hosted language model (Scaleway, France) writes the
recommendations, and each recommendation carries an "AI-generated, not
human-curated" caption. Recommendation cards carry `data-ai-generated="true"`,
and a finished search returns `aiGenerated`, `generatedAt`, `pipelineVersion`
and the generating `model` in its `meta`.

The privacy policy is `apps/desktop/src/ui/privacyPolicyText.ts`, shown in the
app at `#/privacy` and linked from **Settings → Privacy & data**. It names every
processor that receives data (Scaleway, Brave Search, MusicBrainz, optional
Last.fm and Turso), the lawful basis, retention periods and how to exercise
your rights. Two endpoints back the Settings controls:

| Endpoint | Purpose |
|----------|---------|
| `GET /account/export` | Art. 15/20: everything held about the account (profile, saved bands, groups, chat sessions with messages, feedback) |
| `POST /account/delete` | Art. 17: erases every user-scoped row, password-confirmed |

Erasure deletes from every table in `USER_SCOPED_TABLES`
(`services/api/src/privacy/userDataStore.ts`) in one transaction; a schema test
checks that every table with a `user_id` column is on that list. Data flows
per provider are mapped in
[architecture/2026-08-30-data-flow-and-eu-residency.md](architecture/2026-08-30-data-flow-and-eu-residency.md)
(a dated snapshot).

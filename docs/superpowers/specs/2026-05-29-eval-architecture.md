# Design: Eval Architecture — Quality Measurement & Observability

**Date:** 2026-05-29  
**Status:** Draft — approved for implementation (see Roadmap Phase 8)

---

## Goal

Build a three-layer evaluation system that answers one central question: **are our band recommendations actually good?** "Good" means three things simultaneously:

1. **Relevant** — the bands match the sonic direction the user described
2. **Obscure enough** — the bands hit the niche level the user targeted, not the mainstream fallback
3. **Pipeline-earned** — the quality came from the research pipeline working well, not from lucky guessing

The system must be observable in a developer dashboard, comparable across code changes via a baseline mechanism, and progressively enriched by human feedback without burdening the user.

---

## Scope

**In scope:**
- Automatic obscurity scoring (Layer 1)
- LLM-as-judge scoring, async (Layer 2)
- Minimal user feedback signal (Layer 3)
- Developer dashboard with baseline comparison
- Golden dataset for regression testing
- Obscurity target setting in the UI

**Out of scope (deferred):**
- Automatic prompt tuning based on eval scores
- Public-facing quality indicators
- Per-band thumbs-up/down UI (too much friction for first version)

---

## Three Eval Layers

```
Layer 1: Automatic (always, no user needed)
  - Obscurity score via Last.fm listeners
  - Save-rate per session
  - Search source quality (URL heuristics)
  - Pipeline efficiency (verified count, reflection triggered, budget used)

Layer 2: LLM-as-Judge (async, fire-and-forget after each response)
  - Relevance score per band
  - Obscurity fit (target tier vs. actual tier)
  - Evidence quality (is the why-text genuinely grounded?)
  - Discovery value (would a real music nerd want this?)

Layer 3: Human Feedback (optional, one tap per batch)
  - Implicit: band saved = strong positive signal
  - Explicit: single batch-level reaction after recommendations appear
```

Layers are independent — the system works with only Layer 1. Layers 2 and 3 enrich the data progressively.

---

## Obscurity Tiers

Measured via Last.fm `artist.getInfo` → `stats.listeners` (unique listeners).

| Tier | Last.fm Listeners | Planner instruction |
|------|-------------------|---------------------|
| `mainstream` | > 500 000 | — (no instruction) |
| `cult` | 20 000 – 500 000 | "well-known within dedicated communities" |
| `underground` | 2 000 – 20 000 | "obscure, rarely on algorithmic playlists" |
| `obscure` | 0 – 2 000 | "truly underground, minimal online presence" |

**Edge cases:**
- Artist not found on Last.fm → stored as `unknown_obscurity`, treated as potentially positive signal (genuinely underground)
- Last.fm request failure → obscurity fields left null, rest of pipeline unaffected
- Score is computed async after ranking, never on the critical response path

**Why Last.fm, not Spotify:** Spotify removed the `popularity` and `followers` fields from its public API in February 2026. Last.fm's `artist.getInfo` endpoint remains free, rate-limited at 5 req/s, and has historically meaningful listener data for niche/underground artists — the demographic that Last.fm's user base over-indexes on.

---

## Obscurity Target Setting

Three buttons in the UI, default `underground`. No slider for the first version.

```
[ Cult Following ]  [ Underground ]  [ Truly Obscure ]
```

The selected tier is passed as `obscurityTarget` in `POST /recommendations` and stored with the `recommendation_event`. It feeds a constraint into the web search planner prompt. This makes the setting retroactively auditable: we can compare whether `obscure` queries actually produce more obscure results than `cult` queries.

---

## Database Schema

Four new tables, all backed by the active store (SQLite default).

```sql
-- Every recommendation request is logged here
CREATE TABLE recommendation_events (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT,
  user_id             TEXT DEFAULT 'anonymous',
  query               TEXT NOT NULL,
  obscurity_target    TEXT,            -- 'cult' | 'underground' | 'obscure' | null
  recommendations_json TEXT NOT NULL,  -- full ranked array as JSON
  verified_count      INTEGER,
  reflection_triggered INTEGER DEFAULT 0,
  search_budget_used  INTEGER,
  created_at          TEXT NOT NULL
);

-- LLM judge scores, one row per band per event
CREATE TABLE llm_eval_scores (
  id                     TEXT PRIMARY KEY,
  event_id               TEXT NOT NULL REFERENCES recommendation_events(id),
  band_name              TEXT NOT NULL,
  musicbrainz_artist_id  TEXT,
  lastfm_listeners       INTEGER,
  obscurity_tier         TEXT,
  relevance              REAL,   -- 0.0–1.0
  obscurity_fit          REAL,   -- 0.0–1.0
  evidence_quality       REAL,   -- 0.0–1.0
  discovery_value        REAL,   -- 0.0–1.0
  search_source_quality  REAL,   -- 0.0–1.0 (URL heuristic, not LLM)
  reasoning              TEXT,
  judge_model            TEXT NOT NULL,
  created_at             TEXT NOT NULL
);

-- User feedback, one row per event (batch-level)
CREATE TABLE recommendation_feedback (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES recommendation_events(id),
  feedback_type TEXT NOT NULL,  -- 'good' | 'too_mainstream' | 'wrong_genre'
  band_mbid     TEXT,           -- populated when feedback is a save action
  created_at    TEXT NOT NULL
);

-- Named baseline snapshots, created manually before experiments
CREATE TABLE eval_baselines (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,   -- e.g. "before ranker prompt rewrite"
  created_at   TEXT NOT NULL,
  metrics_json TEXT NOT NULL    -- aggregated averages snapshot as JSON
);
```

---

## LLM-as-Judge

**Model:** Claude (via Anthropic API, `ANTHROPIC_API_KEY`). Using a different model than Gemini avoids self-evaluation bias. If `ANTHROPIC_API_KEY` is not set, Layer 2 is silently skipped — it is never on the critical path.

**Timing:** Fire-and-forget worker launched after the HTTP response is sent. Timeout 10 s, no retry on failure. Eval data loss is acceptable; a missing judge score is not a system error.

**Criteria scored per band (not per batch):**

| Field | Description |
|-------|-------------|
| `relevance` | Does the band match the sonic direction of the query? |
| `obscurity_fit` | Does the band hit the obscurity target tier? |
| `evidence_quality` | Is the `why` text grounded in cited evidence, or generic? |
| `discovery_value` | Would a dedicated music nerd genuinely want to discover this? |

**Judge prompt structure:**

```
System: You are an independent music curator. Evaluate band recommendations
        strictly. Do not soften assessments to be encouraging.

User:   Query: "{query}"
        Obscurity target: "{obscurityTarget}"

        Band: {bandName}
        Why text: "{why}"
        Source signals: {sourceSignals}
        Genres (MusicBrainz): {genres}
        Last.fm listeners: {listeners} ({obscurityTier})

        Return JSON only:
        {
          "relevance": 0.0–1.0,
          "obscurity_fit": 0.0–1.0,
          "evidence_quality": 0.0–1.0,
          "discovery_value": 0.0–1.0,
          "reasoning": "one sentence per score below 0.7"
        }
```

---

## Search Source Quality (Automatic, No LLM)

After `brave_initial`, a URL heuristic scores how many results came from known discovery sources:

```typescript
const DISCOVERY_SOURCES = [
  'bandcamp.com', 'rateyourmusic.com', 'reddit.com/r/',
  'metal-archives.com', 'sputnikmusic.com', 'last.fm',
];
// search_source_quality = discoverySourceHits / totalResults
```

This is stored in `llm_eval_scores.search_source_quality`. It enables a key diagnostic: when recommendations are poor, did the searches find the wrong sources, or did everything work but the ranking was wrong?

**Future LangGraph integration (deferred):** Once data shows that low `search_source_quality` correlates with poor recommendations, a `search_quality_check` node can be added to the LangGraph loop between `brave_initial` and `extract`. The planner would then receive feedback about poor source distribution and generate refined queries before extraction. This is explicitly not built now — we collect data first.

---

## User Feedback UI

**Implicit (zero friction, always active):**
- Band saved → `recommendation_feedback` row with `feedback_type = 'good'` and `band_mbid` populated

**Explicit (one tap, optional):**
A feedback bar appears once after recommendations render, disappears after 12 seconds or when the user types their next message. One choice per batch, not per band.

```
How were these suggestions?
[ Spot on ]  [ Too mainstream ]  [ Wrong direction ]
```

No persistent footer, no required action, no modal.

---

## Golden Dataset

File: `services/eval/golden-set.json`

```json
[
  {
    "id": "gs-001",
    "query": "Bands like Alcest and Deafheaven, dreamy black metal",
    "obscurityTarget": "underground",
    "expectedBands": ["Lantlôs", "Amesoeurs", "Heretoir", "Harakiri for the Sky"],
    "antiBands": ["Opeth", "Radiohead"],
    "notes": "Post-black metal, Cascadian/French school. Anti-bands signal lazy mainstream fallback."
  }
]
```

**`antiBands`** are explicitly too well-known bands that reveal when the pipeline takes an easy path instead of searching.

**Metric:** `precision@8` — how many `expectedBands` appear in the top-8 results? Perfect overlap is not expected. Direction matters more than exact matches.

**Usage:** CI-runnable script (`scripts/eval-golden.ts`) that calls the recommendation API with each golden query and computes precision@8. Run manually before/after significant prompt changes.

---

## Developer Dashboard

**Access:** `GET /eval/dashboard` — served as a static HTML page by Express.

**Guard:** Only active when `EVAL_DASHBOARD_ENABLED=true`. Optional `EVAL_DASHBOARD_PASSWORD` adds HTTP Basic Auth.

**No new service, no new port, no build pipeline.** The page is ~200 lines of vanilla JS fetching from three JSON endpoints:

```
GET /eval/metrics          — aggregated scores + delta vs. active baseline
GET /eval/events?limit=50  — recent recommendation_events with scores, filterable
POST /eval/baseline        — create a named snapshot of current aggregated metrics
```

**Dashboard panels:**

**Overview — current vs. baseline delta:**
```
┌──────────────────┬──────────────────┬───────────────────┬─────────────────┐
│ Relevance        │ Obscurity Fit    │ Evidence Quality  │ Discovery Value │
│ 0.74  ↑ +0.06   │ 0.68  ↓ −0.03  │ 0.81  ↑ +0.02   │ 0.71  → +0.00  │
├──────────────────┼──────────────────┼───────────────────┼─────────────────┤
│ Save Rate        │ "Too Mainstream" │ Search Src Quality│ Golden Set P@8  │
│ 23%   ↑ +4%     │ 18%             │ 0.64  ↓ −0.05   │ 5/10  →        │
└──────────────────┴──────────────────┴───────────────────┴─────────────────┘
```

**Trend charts (daily aggregated, rolling 7-day average):**
- LLM judge scores over time (all four dimensions as line chart)
- Save rate trend
- Obscurity tier distribution (stacked bar: what % of recommended bands land in each tier?)
- Human vs. LLM alignment (correlation between `feedback_type` and judge scores)

**Baseline workflow:**
1. Before making a significant change (prompt edit, model swap, new search strategy), create a baseline snapshot with a descriptive label
2. After accumulating ~50 new events, check the dashboard
3. Delta cells turn green (improvement) or red (regression) relative to the snapshot

**Event log:** last N events with query text, obscurity target, judge scores, feedback, and a link to the full `recommendations_json`. Filterable by obscurity target and date range.

---

## File Layout

```
services/api/src/eval/
  evalRepository.ts        — SQL queries for all four eval tables
  evalAggregator.ts        — metric aggregation, delta calculation, baseline snapshots
  evalWorker.ts            — async fire-and-forget: Last.fm fetch + LLM judge dispatch
  evalRoutes.ts            — GET /eval/metrics, GET /eval/events, POST /eval/baseline
  searchSourceScorer.ts    — URL heuristic for discovery source quality
  dashboard/
    index.html             — standalone dashboard page
    dashboard.js           — Chart.js (CDN) + fetch calls, no build step

services/eval/
  golden-set.json          — manually curated query → expected bands dataset
  run-golden.ts            — CI-runnable precision@8 script
```

---

## New Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | No | — | Enables LLM-as-judge (Layer 2). Without it, only automatic scoring runs. |
| `EVAL_DASHBOARD_ENABLED` | No | `false` | Activates `/eval/dashboard` and eval API routes. |
| `EVAL_DASHBOARD_PASSWORD` | No | — | HTTP Basic Auth password for dashboard. Username: `eval`. |

`LASTFM_API_KEY` is already present in the codebase — no change needed there.

---

## Implementation Order

Each step is independently deployable and builds on the previous one.

| Step | What | Notes |
|------|------|-------|
| 1 | `recommendation_events` logging | Fundament for everything. One new table, one INSERT per recommendation call. |
| 2 | Last.fm obscurity score (async) | Enriches events after the response. Requires `LASTFM_API_KEY`. |
| 3 | Obscurity target in UI + API | Three-button UI, new `obscurityTarget` field in request body and event table. |
| 4 | Search source quality scorer | URL heuristic, no external call. Stored with event data. |
| 5 | LLM judge worker (Claude) | Fire-and-forget after each event. Requires `ANTHROPIC_API_KEY`. |
| 6 | `eval_baselines` + snapshot endpoint | Small addition once judge scores exist to compare against. |
| 7 | Developer dashboard | HTML + Chart.js consuming the eval API endpoints. |
| 8 | User feedback button | Minimal UI change. Enriches data but not required for earlier steps. |
| 9 | Golden dataset (10–15 queries) | Manual curation. `run-golden.ts` script for regression runs. |

---

## Open Questions

- Should `recommendation_events` logging respect the user's preference for data storage (i.e. also use Turso when `PREFERENCE_STORE=turso`)? Probably yes — the eval tables should follow the same store as preferences so the data stays together across devices.
- What is the right seed size for a first baseline? Suggest waiting for 30–50 events before making a first snapshot meaningful.
- Should the golden set run in CI automatically or remain a manual script? Start manual; move to CI once the API is stable enough to call in a test environment.

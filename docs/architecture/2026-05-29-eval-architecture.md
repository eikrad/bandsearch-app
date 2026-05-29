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
- Pipeline funnel metrics and retriever/generator diagnostics (Layer 1)
- Deterministic evidence checks — citation support, generic-why flag (Layer 1.5)
- LLM-as-judge scoring, async (Layer 2)
- Judge calibration / meta-evaluation (Step 5b)
- Minimal user feedback signal (Layer 3)
- Developer dashboard with baseline comparison, funnel panel, human–LLM alignment
- Golden dataset for regression testing (P@8, antiBandRate, nuggetCoverage)
- Obscurity target setting in the UI
- Pipeline versioning on recommendation events

**Out of scope (deferred — see Deferred section):**
- Automatic prompt tuning based on eval scores
- Public-facing quality indicators
- Per-band thumbs-up/down UI (too much friction for first version)
- Fine-tuned domain judge (ARES-style)
- Full AutoNuggetizer pipeline
- Pairwise/listwise batch judging

---

## Three Eval Layers

```
Layer 1: Automatic (always, no user needed)
  - Obscurity score via Last.fm listeners
  - Save-rate per session
  - Search source quality (URL heuristics)
  - Pipeline funnel metrics (per LangGraph stage)
  - Pipeline efficiency (verified count, reflection triggered, budget used)

Layer 1.5: Deterministic evidence checks (always, no LLM)
  - Citation support rate (why URLs vs sourceSignals)
  - Generic-why heuristic flag

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

## Retriever vs Generator Diagnostics

Inspired by RAGChecker's split between retriever and generator diagnostics, adapted to the LangGraph research pipeline (`plan` → `brave_initial` → `extract` → `verify` → `reflect_if_needed` → `rank`).

When recommendation quality drops, the dashboard must show **where** in the pipeline the failure occurred — not just that the final output was poor.

| Stage | LangGraph node | Metric | Diagnostic question |
|-------|----------------|--------|---------------------|
| Retriever | `brave_initial` | `brave_hit_count` | Did search return anything? |
| Retriever | `brave_initial` | `search_source_quality` | Did results come from discovery sources? |
| Retriever | `extract` | `extracted_candidate_count` | Did Gemini find band names in snippets? |
| Retriever | `verify` | `verified_count`, `verified_rate` | Did MusicBrainz confirm them? |
| Retriever | `extract` + `verify` | `discovery_source_band_rate` | Of verified bands, how many trace to discovery URLs? |
| Generator | `reflect_if_needed` | `reflection_triggered` | Did the pipeline need a second search round? |
| Generator | `rank` | LLM judge scores | Did ranking produce relevant, grounded recommendations? |

**Retriever failure** → fix search queries, Brave budget, or extraction prompt.  
**Generator failure** → fix ranker prompt, reflection logic, or evidence grounding.

These metrics are stored in `pipeline_diagnostics_json` on each `recommendation_event` (see schema below). The developer dashboard includes a **pipeline funnel panel** showing median counts/rates at each stage, filterable by `pipeline_version` and date range.

---

## Database Schema

Four new tables, all backed by the active store (SQLite default).

```sql
-- Every recommendation request is logged here
CREATE TABLE recommendation_events (
  id                     TEXT PRIMARY KEY,
  session_id             TEXT,
  user_id                TEXT DEFAULT 'anonymous',
  query                  TEXT NOT NULL,
  obscurity_target       TEXT,            -- 'cult' | 'underground' | 'obscure' | null
  recommendations_json   TEXT NOT NULL,  -- full ranked array as JSON
  verified_count         INTEGER,
  reflection_triggered   INTEGER DEFAULT 0,
  search_budget_used     INTEGER,
  pipeline_version       TEXT,           -- git SHA or app semver
  planner_prompt_hash    TEXT,           -- short hash of embedded planner prompt
  ranker_prompt_hash     TEXT,           -- short hash of embedded ranker prompt
  gemini_model           TEXT,
  brave_budget_config    TEXT,           -- JSON snapshot of search budget settings
  pipeline_diagnostics_json TEXT,        -- funnel metrics (see Retriever vs Generator Diagnostics)
  created_at             TEXT NOT NULL
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
  evidence_quality       REAL,   -- 0.0–1.0 (LLM)
  discovery_value        REAL,   -- 0.0–1.0
  search_source_quality  REAL,   -- 0.0–1.0 (URL heuristic, event-level, duplicated per band for joins)
  citation_support_rate  REAL,   -- 0.0–1.0 (deterministic: why URLs in sourceSignals)
  generic_why_flag       INTEGER DEFAULT 0,  -- 1 if template-phrase heuristic matched
  reasoning              TEXT,
  judge_model            TEXT NOT NULL,
  judge_prompt_hash      TEXT,
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

**Model:** Claude (via Anthropic API, `ANTHROPIC_API_KEY`). Using a different model than Gemini avoids self-evaluation bias (MT-Bench self-enhancement pattern). If `ANTHROPIC_API_KEY` is not set, Layer 2 is silently skipped — it is never on the critical path.

**Timing:** Fire-and-forget worker launched after the HTTP response is sent. Timeout 10 s, no retry on failure. Eval data loss is acceptable; a missing judge score is not a system error.

**Judging mode:** Pointwise — one band per judge call. Pairwise/listwise batch judging is deferred (see Deferred section).

**Bias mitigations:**

| Bias | Mitigation |
|------|------------|
| Position bias | One band per call; no batch context in judge prompt |
| Verbosity bias | Judge prompt instructs: score quality, not length of `why` text |
| Self-enhancement | Different model family (Claude) than generator (Gemini) |
| Inconsistency | Optional: 2 judge runs on 10% sample; report score variance in dashboard |

**Deterministic evidence checks (Layer 1.5, before LLM):**

Run on every band before/alongside the LLM judge call:

- `citation_support_rate` = URLs cited in `why` that appear in `sourceSignals` / total URLs in `why`
- `generic_why_flag` = heuristic match for template phrases ("similar sound", "you might enjoy", "fans of X will love")

These feed the LLM judge as context and are stored alongside LLM scores. Large disagreement (e.g. high LLM `evidence_quality` but `citation_support_rate` = 0) flags cases for manual review.

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
        strictly. Do not soften assessments to be encouraging. Score quality,
        not length of the why text.

User:   Query: "{query}"
        Obscurity target: "{obscurityTarget}"

        Band: {bandName}
        Why text: "{why}"
        Source signals: {sourceSignals}
        Genres (MusicBrainz): {genres}
        Last.fm listeners: {listeners} ({obscurityTier})
        Citation support rate (deterministic): {citationSupportRate}
        Generic-why flag: {genericWhyFlag}

        Return JSON only:
        {
          "relevance": 0.0–1.0,
          "obscurity_fit": 0.0–1.0,
          "evidence_quality": 0.0–1.0,
          "discovery_value": 0.0–1.0,
          "reasoning": "one sentence per score below 0.7"
        }
```

### Judge calibration (meta-evaluation)

Layer 2 scores are not trusted for production decisions until the judge is calibrated against human labels (MT-Bench agreement-rate methodology; GroUSE calibration ≠ correlation insight).

**Calibration dataset:**
- ~20–30 hand-labeled band recommendations (query + band + human scores on relevance, obscurity fit, evidence quality)
- ~15–20 Bandsearch-specific unit tests adapted from GroUSE patterns (not the QA dataset):
  - Fabricated evidence URL in `why` not in `sourceSignals`
  - Generic why-text with no sourceSignals
  - Mainstream band when `obscurityTarget` is `obscure`
  - Correct niche match with grounded evidence

**Calibration metrics:**
- Judge–human agreement rate on the labeled set (target: ≥80%, MT-Bench inter-human baseline)
- GroUSE-style unit test pass rate (target: ≥90%)

**Logging:** `judge_model` and `judge_prompt_hash` on every `llm_eval_scores` row. Re-run calibration when either changes.

---

## Search Source Quality and Evidence Checks (Automatic, No LLM)

### Search source quality

After `brave_initial`, a URL heuristic scores how many results came from known discovery sources:

```typescript
const DISCOVERY_SOURCES = [
  'bandcamp.com', 'rateyourmusic.com', 'reddit.com/r/',
  'metal-archives.com', 'sputnikmusic.com', 'last.fm',
];
// search_source_quality = discoverySourceHits / totalResults
```

Stored in `pipeline_diagnostics_json` on the event and duplicated on `llm_eval_scores` for convenient joins. Enables a key diagnostic: when recommendations are poor, did the searches find the wrong sources, or did everything work but the ranking was wrong?

### Deterministic evidence checks (Layer 1.5)

Per band, before the LLM judge:

```typescript
// citation_support_rate = supportedUrls / totalUrlsInWhy
// generic_why_flag = matchesGenericTemplate(whyText)
```

Stored on `llm_eval_scores` (`citation_support_rate`, `generic_why_flag`). Dashboard shows deterministic vs LLM `evidence_quality` side by side.

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
    "nuggets": ["post-black metal", "shoegaze-influenced", "French or Cascadian school"],
    "minNuggetCoverage": 0.5,
    "notes": "Post-black metal, Cascadian/French school. Anti-bands signal lazy mainstream fallback."
  }
]
```

**`expectedBands`** — bands a good pipeline should surface (direction matters more than exact overlap).

**`antiBands`** — explicitly too well-known bands that reveal when the pipeline takes an easy path instead of searching.

**`nuggets`** — atomic sonic properties (genre, era, trait) inspired by nugget evaluation (NuggetRecall / TREC methodology). Manual curation for v1; full AutoNuggetizer pipeline deferred.

**Metrics for `run-golden.ts`:**

| Metric | Description | CI gate |
|--------|-------------|---------|
| `precision@8` | Fraction of `expectedBands` in top-8 | Warn if drops >10% vs last run |
| `antiBandRate@8` | Fraction of top-8 that hit `antiBands` | **Fail if > 0** |
| `nuggetCoverage@8` | Fraction of `nuggets` covered by recommended bands' MB genres/tags | Fail if below `minNuggetCoverage` |
| `ndcg@8` (optional) | Ranking-aware partial credit for expected bands | Informational only |

**Usage:** CI-runnable script (`services/eval/run-golden.ts`) that calls the recommendation API with each golden query and computes all metrics. Run manually before/after significant prompt changes; binary gates (`antiBandRate@8`, `nuggetCoverage@8`) provide pass/fail for regression runs.

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
- Human vs. LLM alignment (see below)
- Pipeline funnel (median counts/rates per LangGraph stage)

**Pipeline funnel panel:**

Shows median `brave_hit_count` → `extracted_candidate_count` → `verified_count` → final recommendation count, plus `search_source_quality` and `discovery_source_band_rate`. Filterable by `pipeline_version`, obscurity target, and date range. When quality drops, pinpoints retriever vs generator failure.

**Human vs. LLM alignment:**

Batch feedback (`good` / `too_mainstream` / `wrong_genre`) is event-level; judge scores are per-band. Aggregation:

1. For each event with explicit feedback, compute **batch-mean judge scores** (avg relevance, obscurity_fit, evidence_quality, discovery_value across all bands).
2. Map feedback → expected direction:
   - `good` → high on all dimensions
   - `too_mainstream` → low obscurity_fit
   - `wrong_genre` → low relevance
3. Report **directional agreement %** (does judge direction match feedback?) and **Spearman correlation** on rolling 7-day window.
4. Implicit saves: band-level positive label; correlate **save rate vs judge discovery_value** per event.

**Baseline workflow:**
1. Before making a significant change (prompt edit, model swap, new search strategy), create a baseline snapshot with a descriptive label **and note `pipeline_version`**
2. After accumulating ~50 new events at the same `pipeline_version`, check the dashboard
3. Delta cells turn green (improvement) or red (regression) relative to the snapshot
4. Filter events by `pipeline_version` / prompt hashes for apples-to-apples comparison

**Event log:** last N events with query text, obscurity target, pipeline funnel summary, judge scores, feedback, and a link to the full `recommendations_json`. Filterable by obscurity target, `pipeline_version`, and date range.

---

## File Layout

```
services/api/src/eval/
  evalRepository.ts        — SQL queries for all four eval tables
  evalAggregator.ts        — metric aggregation, delta calculation, baseline snapshots
  evalWorker.ts            — async fire-and-forget: Last.fm fetch + LLM judge dispatch
  evalRoutes.ts            — GET /eval/metrics, GET /eval/events, POST /eval/baseline
  searchSourceScorer.ts    — URL heuristic for discovery source quality
  evidenceChecker.ts       — deterministic citation_support_rate + generic_why_flag
  judgeCalibration.ts      — human-label agreement + GroUSE-style unit tests
  dashboard/
    index.html             — standalone dashboard page
    dashboard.js           — Chart.js (CDN) + fetch calls, no build step

services/eval/
  golden-set.json          — manually curated query → expected bands + nuggets dataset
  run-golden.ts            — CI-runnable regression script (P@8, antiBandRate, nuggetCoverage)
  judge-calibration.json   — hand-labeled set for meta-evaluation
  judge-unit-tests.json    — GroUSE-style edge cases for judge validation
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
| 1 | `recommendation_events` logging | Fundament for everything. Include `pipeline_diagnostics_json`, `pipeline_version`, prompt hashes. |
| 2 | Last.fm obscurity score (async) | Enriches events after the response. Requires `LASTFM_API_KEY`. |
| 3 | Obscurity target in UI + API | Three-button UI, new `obscurityTarget` field in request body and event table. |
| 4 | Search source quality + evidence checks | URL heuristic + deterministic `citation_support_rate` / `generic_why_flag`. No external call. |
| 5 | LLM judge worker (Claude) | Fire-and-forget after each event. Requires `ANTHROPIC_API_KEY`. |
| 5b | Judge calibration | ~20–30 human labels + ~15–20 GroUSE-style unit tests. Agreement rate before trusting Layer 2. |
| 6 | `eval_baselines` + snapshot endpoint | Small addition once judge scores exist to compare against. Filter by `pipeline_version`. |
| 7 | Developer dashboard | HTML + Chart.js: overview, funnel panel, human–LLM alignment, trend charts. |
| 8 | User feedback button | Minimal UI change. Enriches data but not required for earlier steps. |
| 9 | Golden dataset (10–15 queries) | Manual curation. `run-golden.ts` with P@8, antiBandRate@8, nuggetCoverage@8 gates. |

---

## Deferred (post-Phase 8)

Valuable ideas from eval research, explicitly out of scope for Phase 8:

| Idea | Source | Why defer |
|------|--------|-----------|
| Fine-tuned domain judge (ARES-style) | ARES (Saad-Falcon 2023) | Needs ~150 human labels + training; overkill before golden set exists |
| Full AutoNuggetizer pipeline | NuggetRecall (Pradeep 2025) | Manual `nuggets` in golden set is enough for v1 |
| Pairwise/listwise batch judging | LLMJudge survey (Gu 2025) | Pointwise + batch human reaction is simpler |
| Automatic prompt tuning from eval | — | Correct to defer; collect data first |
| `search_quality_check` LangGraph node | — | Build only once dashboard data confirms correlation |

---

## Open Questions (resolved)

- **Turso backing for eval tables?** Yes — eval tables follow the same store as preferences (`PREFERENCE_STORE=turso`) so data stays together across devices.
- **First baseline seed size?** Wait for 30–50 events at a stable `pipeline_version` before the first snapshot is meaningful.
- **Golden set in CI?** Start manual with binary pass/fail gates (`antiBandRate@8` = 0, `nuggetCoverage@8` ≥ threshold). Move to CI once the API is stable in a test environment.
- **Pipeline versioning?** Yes — log `pipeline_version`, prompt hashes, and model IDs on every event. Baseline labels should include version for apples-to-apples comparison.

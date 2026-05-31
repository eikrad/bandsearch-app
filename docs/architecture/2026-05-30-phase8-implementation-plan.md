# Phase 8 — Eval & Quality Observability
## feature-workflow execution plan

### Context

Next uncompleted roadmap phase: **Phase 8 — Eval & Quality Observability**
(spec: `docs/architecture/2026-05-29-eval-architecture.md`).

Goal: measure whether band recommendations are good (relevant, obscure
enough, pipeline-earned) via three layers — automatic metrics, LLM-as-judge,
user feedback.

**Guiding principle:** eval data loss is acceptable; a missing score is never
a system error. All eval calls are `void asyncFn()` — never awaited on the
critical path.

---

### Progress

| Phase | Status |
|-------|--------|
| 8.1 — Event logging + evalWorker scaffold | ✓ Done |
| 8.2 — Last.fm obscurity scoring | ✓ Done |
| 8.3 — Obscurity target UI + API threading | ✓ Done |
| 8.4 — Search source quality + evidence checks | ✓ Done |
| 8.5 — LLM-as-judge (batched) | — |
| 8.5b — Judge calibration | — |
| 8.6 — Baseline snapshots + eval API | — |
| 8.7 — Developer dashboard | — |
| 8.8 — User feedback reaction bar | — |
| 8.9 — Golden dataset + regression runner | — |

---

### Codebase Conventions

| Concern | Pattern |
|---------|---------|
| Repository | Abstract TS type + factory; SQLite default; in-memory for tests |
| App wiring | `createApp()` → `registerBandsearchRoutes()` via injected context |
| Fire-and-forget | `void asyncFn()` — no `.catch`, no `await` on critical path |
| Logging | `writeStructuredLog(level, obj)` — all eval errors logged here |
| HTTP errors | `sendError(res, status, code, msg)` |
| Tests | Inject fakes via `createApp()`; Jest + tsx; mirror `src/` under `test/` |
| TDD | Red → Green → Refactor; `npm test` green before every commit |
| Commits | English, descriptive, one per phase |

---

### Two Key Design Decisions

**1. One `🔴` interface change only:** `invokeResearchGraph()` return type
gains a `pipelineDiagnostics` field. The `ResearchGraphState` already holds
all needed counts after graph completion (`braveHits.length`,
`extractedCandidates.length`, `verifiedCandidates.filter(v=>v.verified).length`,
`reflectionUsed`, `searchCallsUsed`). Read them from the final state, add to
return value. All downstream callers pass `pipelineDiagnostics` through `meta`
and strip it before the HTTP JSON response.

**2. `evalWorker` as the single integration point:** `recommendationPipeline.ts`
makes exactly **one** fire-and-forget call after each successful recommendation:
```ts
void evalWorker.processEvent(context);
```
`evalWorker` owns the full async pipeline: log event → obscurity → heuristics
→ judge. The pipeline never touches `evalRepository` directly. This keeps
`recommendationPipeline.ts` clean.

---

### Keeping Existing Tests Green

`evalRepository` and `evalWorker` are optional in `CreateAppOptions` with
no-op defaults. The 50+ existing tests never set them and continue to pass.

```ts
// app.ts — no-op defaults mean zero test churn
const resolvedEvalRepository = evalRepository ?? createNoOpEvalRepository();
const resolvedEvalWorker = evalWorker ?? createNoOpEvalWorker();
```

---

### New Environment Variables

```
ANTHROPIC_API_KEY=           # enables LLM-as-judge; completely dormant when absent
EVAL_DASHBOARD_ENABLED=true  # activates all /eval/* routes; absent = 404
EVAL_DASHBOARD_PASSWORD=     # optional HTTP Basic Auth for /eval/dashboard
```

All `/eval/*` routes are gated behind `EVAL_DASHBOARD_ENABLED=true`. This is
read once in `env.ts` and threaded into `BandsearchRouteContext` — not
repeated per route.

---

### Database Schema (4 tables, all `CREATE TABLE IF NOT EXISTS`)

Created in `evalRepository.ts` on init, identical pattern to
`chatSessionRepository.ts`.

```sql
CREATE TABLE IF NOT EXISTS recommendation_events (
  id           TEXT PRIMARY KEY,
  session_id   TEXT,
  query        TEXT NOT NULL,
  mode         TEXT NOT NULL,                 -- 'fresh'|'preference-aware'
  obscurity_target TEXT,                      -- 'cult'|'underground'|'obscure'|null
  pipeline_version TEXT NOT NULL,
  brave_hit_count       INTEGER NOT NULL DEFAULT 0,
  extracted_count       INTEGER NOT NULL DEFAULT 0,
  verified_count        INTEGER NOT NULL DEFAULT 0,
  reflection_triggered  INTEGER NOT NULL DEFAULT 0,  -- 0|1
  search_budget_used    INTEGER NOT NULL DEFAULT 0,
  recommendation_count  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

-- One row per (event, band). Deterministic cols filled in Phase 8.4,
-- LLM cols upserted in Phase 8.5. nulls are valid until then.
CREATE TABLE IF NOT EXISTS band_eval_scores (
  id               TEXT PRIMARY KEY,
  event_id         TEXT NOT NULL REFERENCES recommendation_events(id),
  band_name        TEXT NOT NULL,
  listeners        INTEGER,
  obscurity_tier   TEXT,
  source_quality   TEXT,               -- 'high'|'medium'|'low'
  citation_support_rate REAL,
  generic_why_flag INTEGER,            -- 0|1
  relevance        REAL,               -- LLM judge 0.0-1.0
  obscurity_fit    REAL,
  evidence_quality REAL,
  discovery_value  REAL,
  judge_reasoning  TEXT,
  judge_prompt_hash TEXT,
  model_id         TEXT,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES recommendation_events(id),
  user_id       TEXT NOT NULL DEFAULT 'anonymous',
  feedback_type TEXT NOT NULL,        -- 'good'|'too_mainstream'|'wrong_direction'
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS eval_baselines (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
```

`band_eval_scores` merges what the spec called two tables into one — simpler
schema, one `upsertBandEvalScore()` method that works across both phases.

---

### New Files

```
services/api/src/eval/
  evalRepository.ts       ✓ abstract type + no-op + in-memory + SQLite factory
  evalWorker.ts           ✓ single entry point: processEvent() orchestrates all steps
  lastFmClient.ts         ✓ getListenerCount(name): Promise<number|null>
  obscurityScorer.ts      ✓ classifyObscurityTier(listeners): ObscurityTier (pure)
  evalAggregator.ts       pure aggregation fns (no DB, no I/O — easy to test)
  evalRoutes.ts           registerEvalRoutes(app, ctx) — all /eval/* handlers
  searchSourceScorer.ts   DISCOVERY_DOMAINS constant + scoreSearchSources() (pure)
  evidenceChecker.ts      checkEvidence(why, signals): EvidenceReport (pure)
  judgeWorker.ts          buildJudgePrompt() + one batched call per event
  judgeCalibration.ts     computeAgreementRate() + runUnitTests() (pure)
  dashboard/index.html    ~400-line self-contained HTML + inlined JS + Chart.js CDN

services/eval/
  golden-set.json         10-15 curated regression queries
  run-golden.ts           metric fns + runner script
  judge-calibration.json  20-30 hand-labeled samples
  judge-unit-tests.json   GroUSE-style edge cases
  run-calibration.ts      agreement rate measurement script
  package.json            { "scripts": { "golden": "tsx run-golden.ts" } }

apps/desktop/src/components/
  ObscurityTargetPicker.ts   3-button obscurity selector (no JSX — .ts)
  FeedbackReactionBar.ts     batch-level reaction bar (no JSX — .ts)
```

### Modified Files

| File | Change |
|------|--------|
| `researchGraph.ts` | 🔴 extend `invokeResearchGraph` return → add `pipelineDiagnostics` |
| `researchService.ts` | 🟡 thread `pipelineDiagnostics` through to callers |
| `recommendationPipeline.ts` | 🟡 accept optional `evalWorker`; `void evalWorker.processEvent()` |
| `app.ts` | ✓ init `evalRepository`+`evalWorker`; no-op defaults; new env vars |
| `registerBandsearchRoutes.ts` | 🟡 add `evalRepository`+`evalDashboardEnabled` to context; call `registerEvalRoutes()` |
| `shared/schemas/contracts.ts` | 🟡 add `ObscurityTarget` type + optional `obscurityTarget?` to request |
| `config/env.ts` | ✓ add `evalDashboardEnabled`; needs `anthropicApiKey`, `evalDashboardPassword` |
| `webSearchPlanner.ts` | 🟡 import `DISCOVERY_DOMAINS` from `searchSourceScorer.ts`; inject obscurity constraint |
| `apps/desktop/src/ui/ChatAppView.ts` | 🟡 add `ObscurityTargetPicker` + `FeedbackReactionBar` |
| `apps/desktop/src/chatClient.ts` | 🟡 add `obscurityTarget`; return `eventId`; add `sendFeedback()` |

**Reuse:** `lastFmApiKey` already in `AppRuntimeConfig` — same key, no new config.
`DISCOVERY_DOMAINS` defined once in `searchSourceScorer.ts`, imported by
`webSearchPlanner.ts` (Phase 8.3) — no duplication.

---

### Phase-by-Phase Plan

---

#### ✓ Phase 8.1 — Event Logging + evalWorker scaffold

Done. Key files: `evalRepository.ts`, `evalWorker.ts`, wired into
`recommendationPipeline.ts` and `app.ts`.

---

#### ✓ Phase 8.2 — Last.fm Obscurity Scoring

Done. Key files: `lastFmClient.ts`, `obscurityScorer.ts`. `evalWorker`
now calls `scoreObscurity()` via `Promise.allSettled` after logging each event.
Also fixed a bug: `resolvedChatSessionRepository` and `resolvedUserRepository`
in `app.ts` had their factory functions swapped; regression test added in
`test/user-repository-fallback.test.js`.

---

#### Phase 8.3 — Obscurity Target UI + API Threading 🟡
_(next — can run in parallel with 8.9 if you want to split work)_

**Build:**
1. `shared/schemas/contracts.ts`: `ObscurityTarget = 'cult' | 'underground' | 'obscure'`.
   Add `obscurityTarget?: ObscurityTarget` to `ValidatedRecommendationHttpBody`.
   Invalid values silently become `undefined`.
2. `ObscurityTargetPicker.ts` — three `React.createElement('button', ...)`;
   active button gets `className: 'active'`; props `{ target, onTargetChange }`.
   No JSX; `.ts` extension; matches existing component style in `ChatAppView.ts`.
3. `webSearchPlanner.ts`: import `DISCOVERY_DOMAINS` from `searchSourceScorer.ts`
   (preempts Phase 8.4 to establish single source of truth immediately). Add
   `obscurityTarget?` to planner input; inject one-line constraint into the
   planner user prompt when present.
4. Thread `obscurityTarget` through: `validateRecommendationHttpBody` →
   `recommendationPipeline.recommend` → `invokeResearchGraph` → planner node.
   Also included in `EvalEventContext` for logging.
5. `chatClient.ts`: add `obscurityTarget` to request body; read `eventId` from
   response `meta` (needed for Phase 8.8 feedback).

**Tests (write first):**
- `shared/schemas/test`: accepts valid `obscurityTarget`; silently ignores invalid
- `test/obscurity-target-picker.test.js`: renders 3 buttons; toggles active; calls callback
- `test/recommendations-route.test.js`: `obscurityTarget` threads to pipeline

**Commit:** `feat(eval): obscurity target picker and API threading`

---

#### Phase 8.4 — Search Source Quality + Evidence Checks 🟢

**Build:**
1. `searchSourceScorer.ts` — exported `DISCOVERY_DOMAINS` string array
   (Bandcamp, RYM, Reddit, Metal Archives, Sputnik, Last.fm). Pure
   `scoreSearchSources(urls: string[]): number` — ratio of discovery-domain hits.
2. `evidenceChecker.ts` — pure `checkEvidence(why: string, signals: string[]): EvidenceReport`.
   `citationSupportRate`: URLs in `why` that appear in `signals` / total URLs
   in `why` (regex `https?://[^\s)]+`). `genericWhyFlag`: match
   `GENERIC_PHRASES` list against `why.toLowerCase()`.
3. `evalRepository.ts`: add `upsertBandEvalScore(score)`. In SQLite:
   `INSERT OR REPLACE` (merges with existing row from Phase 8.2 if present).
4. `evalWorker.ts`: add internal `scoreHeuristics(ctx)` step. Computes
   `source_quality` and `{ citationSupportRate, genericWhyFlag }` per band.
   Calls `upsertBandEvalScore()` with deterministic fields. LLM columns
   remain null — the row exists and Phase 8.5 will upsert into it.

**Tests (write first):**
- `test/eval/search-source-scorer.test.js`: all-discovery, all-generic, mixed, empty
- `test/eval/evidence-checker.test.js`: cited vs. uncited; `genericWhyFlag` true/false

**Commit:** `feat(eval): search source quality and evidence heuristics`

---

#### Phase 8.5 — LLM-as-Judge Worker (batched) 🟢

**Key design:** one Anthropic API call per **event** (not per band). The prompt
lists all bands as a JSON array; Claude returns one score object per band.
This is 8× cheaper, faster, and simpler than per-band calls.

**Build:**
1. `judgeWorker.ts`:
   - Pure `buildJudgePrompt(bands: JudgeInput[]): AnthropicMessages`. System
     message = judge rubric (static → enable prompt caching via
     `cache_control: { type: "ephemeral" }` on the system message). User
     message = JSON array of all bands with query + obscurityTarget + why +
     sourceSignals + listeners + citationSupportRate + genericWhyFlag.
   - `createJudgeWorker({ anthropicApiKey, evalRepository, fetchImpl? })`.
   - `judgeEvent(eventId, bands[])`: no-op when `anthropicApiKey` is empty.
     One call to `claude-opus-4-8`. Parses response as `{ [bandName]: { relevance, obscurity_fit, evidence_quality, discovery_value, reasoning } }`.
     10 s `AbortController` timeout. Upserts via `evalRepository.upsertBandEvalScore()`.
     Stores `judge_prompt_hash = sha256(system + user)` for calibration drift
     detection.
2. `evalWorker.ts`: chain `judgeEvent` as the final step in `processEvent`.
3. `config/env.ts` + `app.ts`: add `anthropicApiKey`; pass to `evalWorker`.

**Tests (write first — all use stubbed `fetchImpl`, no real calls):**
- Prompt contains all bands in one call (not per-band)
- Parses batch JSON response correctly
- No-op when `anthropicApiKey` empty
- No throw on timeout; no throw on malformed JSON
- `upsertBandEvalScore` called once per band with parsed scores

**Refactor:** `buildJudgePrompt` exported and snapshot-tested independently.

**Commit:** `feat(eval): batched LLM-as-judge via Claude with prompt caching`

---

#### Phase 8.5b — Judge Calibration 🟢

**Build:**
1. `judge-calibration.json` — 20–30 entries:
   `{ query, obscurityTarget, bandName, whyText, sourceSignals, listeners, humanScores: { relevance, obscurityFit, evidenceQuality } }`.
   All 0–1 floats. Cover all obscurity tiers and quality levels.
2. `judge-unit-tests.json` — 15–20 GroUSE-style edge cases:
   `{ id, description, input, expectedDirection: { evidenceQuality: 'low'|'high', obscurityFit: 'low'|'high' } }`.
   Include: fabricated URL not in `sourceSignals`, generic why-text,
   mainstream band with `obscure` target, correct niche match.
3. `judgeCalibration.ts` — pure functions:
   `computeAgreementRate(humanLabels, judgeScores): { rate, perDimension }` —
   directional match (both above/below 0.5).
   `runUnitTests(tests, judgeScores): { passRate, failures }`.
4. `run-calibration.ts`: load labels → call judge → print table → warn if <80%
   (exit 1 if <60% — "warn" threshold is advisory, "fail" threshold is hard).

**Tests (write first):**
- `computeAgreementRate`: 100% on identical data; 0% on inverted; handles nulls
- `runUnitTests`: correctly counts passes/failures

**Commit:** `test(eval): judge calibration dataset and agreement computation`

---

#### Phase 8.6 — Baseline Snapshots + Eval API 🟢

**Build:**
1. `evalAggregator.ts` — pure functions (no DB, no I/O):
   `aggregateMetrics(events, bandScores): AggregatedMetrics` — mean judge
   scores, obscurity tier distribution, source quality distribution, citation
   support rate, generic-why rate, event count.
   `computeDelta(current, baseline): MetricsDelta`.
2. `evalRepository.ts`: add `createBaseline(label, metricsJson)`,
   `listBaselines()`, `getLatestBaseline()`.
3. `evalRoutes.ts` — `registerEvalRoutes(app, ctx)`:
   - All routes return 404 when `!ctx.evalDashboardEnabled`
   - `GET /eval/events?limit=50` — with embedded `bandScores` per event
   - `GET /eval/metrics` — `{ current, baseline|null, delta|null }`
   - `POST /eval/baseline` — body `{ label }` → aggregate → store → return `{ id, label, createdAt }`
   - `GET /eval/baselines` — list all

**Tests (write first):**
- `evalAggregator.test.js`: seeded data → correct means and distributions; delta math
- `eval-routes.test.js`: 404 when disabled; POST baseline creates row; GET metrics returns delta

**Commit:** `feat(eval): baseline snapshots and eval API endpoints`

---

#### Phase 8.7 — Developer Dashboard 🟢

One self-contained HTML file. No separate JS file to serve or path to resolve.

**Build:**
1. `dashboard/index.html` — ~400 lines total (HTML + inlined `<script>`).
   Chart.js loaded from CDN. Four panels:
   - Metric tiles grid with delta arrows vs. latest baseline
   - Trend line chart (4 judge dimensions, last 30 days from `/eval/events`)
   - Obscurity tier stacked bar + pipeline funnel
   - Event log table with query text and per-band scores
   Fetches `/eval/metrics` + `/eval/events?limit=50` at load. Plain IIFE,
   no framework, no bundler.
2. `evalRoutes.ts`: add `GET /eval/dashboard` — reads `index.html` from disk
   relative to `import.meta.url`, serves with `Content-Type: text/html`.
   If `EVAL_DASHBOARD_PASSWORD` set: enforce HTTP Basic Auth (any username,
   configured password); on failure return 401 with `WWW-Authenticate: Basic
   realm="eval"` header.

**Tests (write first):**
- Route returns 404 when disabled; 200 HTML when enabled + no password;
  401 with missing auth header when password set; 200 with correct auth

**Commit:** `feat(eval): self-contained developer dashboard`

---

#### Phase 8.8 — User Feedback Reaction Bar 🟡

**Build:**
1. `evalRepository.ts`: add `logFeedback(input: FeedbackInput): Promise<void>`.
2. `evalRoutes.ts`: add `POST /eval/feedback` — validates `feedback_type` enum;
   calls `evalRepository.logFeedback()`; returns `{ ok: true }`.
3. `registerBandsearchRoutes.ts`: expose `eventId` in `POST /recommendations`
   response `meta` field so the UI can reference it.
4. `FeedbackReactionBar.ts` — `React.createElement` component. Props:
   `{ visible: boolean; onFeedback(type): void; onDismiss(): void }`. Three
   buttons + label. `useEffect` auto-dismiss after 12 s.
5. `ChatAppView.ts`: render `FeedbackReactionBar` after last recommendation
   batch. Wire `viewProps.showFeedbackBar` + `handlers.onFeedback`.
6. `chatAppModel.ts`: `showFeedbackBar` state (true after new recommendation
   batch; cleared on next query or 12 s); `submitFeedback(type)`.
7. `chatClient.ts`: `sendFeedback(eventId, feedbackType)` → `POST /eval/feedback`.

**Tests (write first):**
- `eval-routes.test.js`: `POST /eval/feedback` stores row, returns ok; 400 on invalid enum
- `feedback-reaction-bar.test.js`: renders 3 buttons; calls `onFeedback(type)`; hidden when `visible=false`

**Commit:** `feat(eval): user feedback reaction bar and /eval/feedback endpoint`

---

#### Phase 8.9 — Golden Dataset + Regression Runner 🟢
_(can run in parallel with 8.3–8.8 immediately)_

**Build:**
1. `golden-set.json` — 10–15 entries:
   `{ id, query, obscurityTarget, expectedBands, antiBands, nuggets, notes }`.
   Cover: blackgaze, death-doom, drone, jazz-adjacent, folk-adjacent,
   noise rock — varied obscurity targets.
2. `run-golden.ts` — exported pure metric functions (testable without API):
   `computePrecisionAtK(expected, results, k)`,
   `computeAntiBandRate(antiBands, results, k)`,
   `computeNuggetCoverage(nuggets, results, k)`.
   Script: reads `BANDSEARCH_API_URL` (default `http://localhost:3001`); calls
   `POST /recommendations` per query; prints results table. Exits 1 only if
   any `antiBandRate > 0.5` (catastrophic gate — softer than zero tolerance
   until golden set matures). Warns (no exit) when `precision@8` drops >10%.
   Use `--strict` flag to opt into zero-tolerance anti-band gate.
3. `services/eval/package.json` + add to `pnpm-workspace.yaml`.

**Tests (write first):**
- `run-golden.test.ts`: all three metric fns — 100%/0% cases + partial matches + k boundary

**Commit:** `feat(eval): golden dataset and P@8 regression runner`

---

### Dependency Graph

```
8.1  event logging + evalWorker scaffold       ✓ done
8.2  Last.fm obscurity                         ✓ done
8.3  obscurity target UI/API                   ← next
8.4  heuristics                                ← 8.2
8.5  LLM judge (batched)                       ← 8.4
8.5b calibration                               ← 8.5
8.6  baselines + eval API                      ← 8.4, 8.5
8.7  dashboard                                 ← 8.6
8.8  feedback bar                              ← 8.6
8.9  golden dataset                            ← 8.1  (can start now)
```

---

### Pre-flight

```bash
npm run test --workspaces --if-present   # must be green before each phase
```

### Verification

```bash
# After 8.3+: curl with obscurityTarget
curl -X POST http://localhost:3001/recommendations \
     -H 'Content-Type: application/json' \
     -d '{"query":"blackgaze bands","obscurityTarget":"underground"}'

# After 8.6: snapshot a baseline
curl -X POST http://localhost:3001/eval/baseline \
     -H 'Content-Type: application/json' -d '{"label":"initial"}'

# After 8.7: open dashboard
open http://localhost:3001/eval/dashboard

# After 8.5b: measure judge agreement
ANTHROPIC_API_KEY=... npx tsx services/eval/run-calibration.ts

# After 8.9: regression (requires live API)
BANDSEARCH_API_URL=http://localhost:3001 npx tsx services/eval/run-golden.ts

# Full CI
npm run ci
```

### Roadmap Update

After each committed phase: mark the corresponding step in `docs/ROADMAP.md`
as `✓ Done`.

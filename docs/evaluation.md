# Offline evaluation: golden runs and dashboard

How to measure recommendation quality outside live traffic. The online eval layer (tiers, tables, live dashboard) is described in [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md#evaluation-layer).


The golden set (`services/eval/golden-set.json`) is the regression check for
recommendation quality. Start the API (`npm run dev` or the desktop
sidecar), then:

```bash
npm run golden -w services/eval -- --label baseline --repeat 3   # three runs of one setup
npm run dashboard -w services/eval                               # rebuild the dashboard on its own
```

For comparing models, start the API **and** the runner with `EVAL_REPLAY_DIR`
(e.g. `services/eval/replay`): Brave, MusicBrainz and Last.fm answers are
recorded on first use and replayed afterwards, so every model sees the same
search data and repeat runs skip MusicBrainz's 1 req/s limit. LLM calls always
run live. Coverage uses MusicBrainz tags and, for bands without any, Last.fm
listener tags (`LASTFM_API_KEY`). Some golden queries carry hard
**constraints** — "from Iceland", "formed after 2015", "shares a member with
Alcest" — that the runner checks against MusicBrainz with plain code, no LLM
involved.

Every run appends one line to `services/eval/history/golden-runs.jsonl`
(committed): git commit, the model the API reported, and per query the
status, `nuggetCoverage@8`, `antiBandRate@8`, latency and top 8. It then
rewrites `services/eval/reports/dashboard.html` (gitignored), a self-contained
page that compares each run with the latest run labelled `baseline` and with
the previous run: flipped queries with a sign test, how much the top 8 changed
against the noise floor of repeat runs, and changed settings. Its **Setups**
section groups repeats of one configuration and compares each setup with the
baseline's per query, with a 95% interval (paired bootstrap); only differences
outside the noise are highlighted.

The judge is checked the same way: `npm run calibrate -w services/eval` scores
the 25 hand-labelled examples and 16 directional checks with the configured
judge (`--judge <model>` compares candidates) and appends the agreement to
`services/eval/history/judge-runs.jsonl`.

A run on uncommitted tracked files is refused unless `--allow-dirty` is given;
`--no-history` skips recording. `BANDSEARCH_API_URL` points the runner at
another deployment, `BANDSEARCH_API_TOKEN` authenticates against one with more
than one account. The live-traffic dashboard at `GET /eval/dashboard` (404 unless
`EVAL_DASHBOARD_ENABLED=true`; `EVAL_DASHBOARD_PASSWORD` adds Basic Auth) is a
different thing: it shows scores from real requests, not test runs.

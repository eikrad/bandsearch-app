# ADR 0003 — Android hosting: Render Free over Fly.io

**Status:** Accepted
**Date:** 2026-09-28

## Context

Android is remote-API-only (see `docs/superpowers/plans/2026-08-30-android.md`
— no sidecar, no `better-sqlite3` on mobile), so it is hard-dependent on a
reachable, always-available production API. Two hosts were compared while
planning: Render Free (no cost, but a 30–60s cold-start wake after idling) and
Fly.io (scale-to-zero, ~300ms–2s wake, ~$0.15/month idle). Measured: the API
idles at 61 MB RSS, so either host's smallest instance has capacity — this was
a cold-start-vs-cost decision, not a capacity one.

## Decision

**Render Free.** The 30–60s cold-start on a dropped-to-sleep instance is
accepted as a known, deliberate trade-off in exchange for zero hosting cost,
over paying Fly.io's ~$0.15/month for a nine-hundred-times-faster wake.

## Alternatives considered

**Fly.io.** Rejected despite being the better UX fit for a mobile client,
where a 30–60s hang on first open reads as broken rather than slow — the
project prioritises running the whole stack at zero cost over that latency
difference.

## Related fact, not decisive here

`docs/architecture/2026-08-30-data-flow-and-eu-residency.md` records that
`render.yaml` already pins compute to `region: frankfurt`. Fly.io also offers
a Frankfurt region, so residency was not a differentiator between the two
options — this decision was cost-vs-latency only, and does not change the EU
residency picture in that note (still residency, not sovereignty: Render
remains a US-incorporated company).

## Consequences

- Every cold open of the Android app after a period of inactivity will hang
  for up to a minute before the first response. This is a deliberate,
  known-bad first-open experience, not a bug to file.
- Phase 9.5 ("verify Render + Turso end-to-end") already targets Render, so
  this decision needs no infrastructure change — it confirms the existing
  default rather than picking a new one.
- If the cold-start proves worse in practice than expected (e.g. testers
  abandon the app before it wakes), revisiting this ADR in favour of Fly.io is
  a config and secrets change, not a re-architecture.

## Related

- `docs/superpowers/plans/2026-08-30-android.md` — full Android design session
- `docs/ROADMAP.md` — Phase 9.5, Phase 11

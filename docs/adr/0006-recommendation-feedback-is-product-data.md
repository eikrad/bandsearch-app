# ADR 0006 — Recommendation feedback is product data, read with the admin CLI

**Status:** Accepted
**Date:** 2026-11-18 (#307, #306)

## Context

The feedback bar under a recommendation batch (Spot on / Too mainstream /
Wrong direction) is the closed beta's most direct signal of whether
recommendations land. Until now none of it reached the operator:

- The desktop mount never forwarded the bar's handlers, so a click did nothing.
- Behind that, the client posted to `/eval/feedback`. All `/eval/*` routes
  return 404 unless `EVAL_DASHBOARD_ENABLED=true`, and production runs with
  it disabled. The client dropped the failure silently.
- With the dashboard on, rows went to the eval store: a local SQLite file,
  separate from the account database (Turso in production) and lost on every
  Render deploy. They carried only an event id and a type, and the event they
  pointed to is eval telemetry that is not recorded with the dashboard off.
  `eval/recommendationFeedback.ts` merged rows across both databases so that
  account export and deletion still covered them.

The eval dashboard never read feedback. The coupling was one of location only.

## Decision

1. **Feedback is product data.** It belongs to the account, not to eval
   telemetry, and lives in the main database next to the other account data,
   through the storage module. Account export and erasure cover it in one
   database, with no cross-database merge.
2. **It works with the eval dashboard off.** The route is
   `POST /recommendations/:eventId/feedback`, behind the same auth and rate
   limit as the recommendations it judges. The owner comes from the token,
   never from the body. An install without accounts stores it without one.
3. **Each verdict carries the batch it judges.** The client sends the query,
   mode, obscurity target and the bands shown, as they were when the batch was
   asked. In production nothing else records the batch, and a verdict without
   its batch cannot be read. The server caps the query at 500 characters and
   the list at 20 bands. One row per event and user; a later click replaces the
   earlier one.
4. **The operator reads it with the admin CLI**, `npm run feedback:list --
   [--days N] [--json]`, from their own machine with the database credentials,
   like the invite commands (ADR 0005). It shows the user's email address: the
   beta's testers are invited by address and the operator already holds full
   database access, and asking a tester what was wrong is the point.
5. **Kept for 90 days** (`FEEDBACK_RETENTION_DAYS` in the shared contracts),
   purged by the API at startup and daily, whatever the eval dashboard does.
   The privacy policy discloses what is stored, that the operator reads it, and
   for how long.
6. The old table is dropped, not migrated (migration `006`): its rows had no
   context and no real owner, and production never wrote one.

## Consequences

- Migration `006` must be applied to Turso (`npm run migrate:turso`) before the
  API that writes the new shape is deployed.
- Eval keeps its own store (local SQLite or a no-op) and can still join
  feedback by event id later, through the feedback module, if it ever needs to.
  It no longer owns or purges feedback.
- Every recommendation response carries an `eventId`, whether or not eval runs.
- Feedback shares the recommendations rate limit, so heavy clicking counts
  against the same 30 requests per minute.

## Alternatives considered

- **A weekly digest by email** (Scaleway Transactional Email or SMTP). Rejected:
  needs a verified sending domain or a mailbox password as a new secret, a
  scheduler (Render's free plan sleeps, so in practice a GitHub Actions cron),
  and care that a public repository's workflow logs never show feedback. Reading
  on demand with the CLI needs none of that.
- **A GitHub issue per week.** Rejected: the repository is public, and feedback
  contains users' search text.
- **An admin endpoint or dashboard on the hosted API.** Rejected for the same
  reason as in ADR 0005: more surface to secure for one operator.
- **Recording every recommendation batch in the main database** and letting a
  verdict refer to it by id. Rejected: a write on every recommendation,
  including the many nobody rates, to serve the few that are.
- **Keeping feedback in the eval store and only lifting the dashboard gate**
  for its route. Rejected: the rows would still live in a file that production
  loses on every deploy, beside data the operator never reads.

-- Recommendation feedback moves out of the eval layer into the main database.
-- See ADR 0006 and #307.
--
-- The old table (002) had a foreign key to recommendation_events, which is eval
-- telemetry and is never written in production, and it stored no context, so
-- a verdict could not be read on its own. Production never wrote a row to it
-- (the route sat behind the disabled eval dashboard). It is dropped, not
-- migrated.
--
-- The new row carries the batch it judges: query, mode, obscurity target and
-- the bands shown (a JSON list). user_id is NULL on an install without
-- accounts. One row per event and user is kept by the application, which
-- deletes the earlier verdict before inserting (a UNIQUE index would treat
-- NULL users as distinct). Must stay in step with FEEDBACK_TABLE_DDL in
-- src/feedback/feedbackRepository.ts.

DROP TABLE IF EXISTS recommendation_feedback;

CREATE TABLE recommendation_feedback (
  id               TEXT PRIMARY KEY,
  event_id         TEXT NOT NULL,
  user_id          TEXT,
  feedback_type    TEXT NOT NULL,
  query            TEXT NOT NULL,
  mode             TEXT NOT NULL,
  obscurity_target TEXT,
  band_names       TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL
);

CREATE INDEX idx_recommendation_feedback_event_user ON recommendation_feedback (event_id, user_id);

CREATE INDEX idx_recommendation_feedback_created_at ON recommendation_feedback (created_at);

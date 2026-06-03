-- Full schema for Turso/libSQL deployment.
-- All tables use CREATE TABLE IF NOT EXISTS so the script is safe to run
-- against a database that already has some tables created.

CREATE TABLE IF NOT EXISTS users (
  id                 TEXT PRIMARY KEY,
  email              TEXT NOT NULL UNIQUE,
  display_name       TEXT NOT NULL,
  password_hash      TEXT NOT NULL,
  recovery_code_hash TEXT NOT NULL,
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_bands (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL DEFAULT 'anonymous',
  musicbrainz_artist_id  TEXT NOT NULL,
  name                   TEXT NOT NULL,
  rating                 INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  categories             TEXT NOT NULL DEFAULT '[]',
  note                   TEXT NOT NULL DEFAULT '',
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artist_groups (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL DEFAULT 'anonymous',
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artist_group_members (
  group_id      TEXT NOT NULL REFERENCES artist_groups(id) ON DELETE CASCADE,
  saved_band_id TEXT NOT NULL REFERENCES saved_bands(id) ON DELETE CASCADE,
  added_at      TEXT NOT NULL,
  PRIMARY KEY (group_id, saved_band_id)
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL DEFAULT 'anonymous',
  title      TEXT NOT NULL DEFAULT 'Untitled',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id),
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages (session_id);

CREATE TABLE IF NOT EXISTS recommendation_events (
  id                    TEXT PRIMARY KEY,
  session_id            TEXT,
  query                 TEXT NOT NULL,
  mode                  TEXT NOT NULL,
  obscurity_target      TEXT,
  pipeline_version      TEXT NOT NULL,
  brave_hit_count       INTEGER NOT NULL DEFAULT 0,
  extracted_count       INTEGER NOT NULL DEFAULT 0,
  verified_count        INTEGER NOT NULL DEFAULT 0,
  reflection_triggered  INTEGER NOT NULL DEFAULT 0,
  search_budget_used    INTEGER NOT NULL DEFAULT 0,
  recommendation_count  INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS band_eval_scores (
  id                    TEXT PRIMARY KEY,
  event_id              TEXT NOT NULL REFERENCES recommendation_events(id),
  band_name             TEXT NOT NULL,
  listeners             INTEGER,
  obscurity_tier        TEXT,
  source_quality        TEXT,
  citation_support_rate REAL,
  generic_why_flag      INTEGER,
  relevance             REAL,
  obscurity_fit         REAL,
  evidence_quality      REAL,
  discovery_value       REAL,
  judge_reasoning       TEXT,
  judge_prompt_hash     TEXT,
  model_id              TEXT,
  created_at            TEXT NOT NULL,
  UNIQUE(event_id, band_name)
);

CREATE INDEX IF NOT EXISTS idx_band_eval_scores_event_id ON band_eval_scores (event_id);

CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES recommendation_events(id),
  user_id       TEXT NOT NULL DEFAULT 'anonymous',
  feedback_type TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recommendation_feedback_event_id ON recommendation_feedback (event_id);

CREATE TABLE IF NOT EXISTS eval_baselines (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

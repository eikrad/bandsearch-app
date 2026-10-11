-- Closed beta: email-bound invites and the ability to switch an account off.
-- See ADR 0005 and #266.
--
-- invites: one row per issued invite. Only the SHA-256 hash of the code is
-- stored (code_hash), so a database leak does not leak usable codes. The code
-- is bound to one address (email, stored normalized: trimmed, lower-cased).
-- Single use is enforced twice: by users.email UNIQUE (the invite is bound to
-- that address) and by the conditional UPDATE that sets used_at.
--
-- users.disabled_at: NULL for active accounts, an ISO timestamp for accounts
-- an operator has switched off. A plain ADD COLUMN like 004, so existing rows are
-- active (NULL), which is what they were.

CREATE TABLE IF NOT EXISTS invites (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  revoked_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_invites_email ON invites (email);

ALTER TABLE users ADD COLUMN disabled_at TEXT;

-- Make saved_bands.rating nullable, so "saved but not yet rated" is storable.
--
-- The old column was `INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5)`,
-- which forced every save to carry a number and is why the desktop invented
-- one (3 for Save, 5 for Rate) without telling the user. See CONTEXT.md
-- (**Rating**) and issue #164.
--
-- SQLite cannot drop or alter a CHECK constraint in place, so the table is
-- rebuilt. Written to be safe to run twice: the temp table is dropped first,
-- and existing rows keep their ratings unchanged.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS saved_bands_new;

CREATE TABLE saved_bands_new (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL DEFAULT 'anonymous',
  musicbrainz_artist_id  TEXT NOT NULL,
  name                   TEXT NOT NULL,
  rating                 INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  categories             TEXT NOT NULL DEFAULT '[]',
  note                   TEXT NOT NULL DEFAULT '',
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

INSERT INTO saved_bands_new (id, user_id, musicbrainz_artist_id, name, rating, categories, note, created_at, updated_at)
  SELECT id, user_id, musicbrainz_artist_id, name, rating, categories, note, created_at, updated_at
  FROM saved_bands;

DROP TABLE saved_bands;
ALTER TABLE saved_bands_new RENAME TO saved_bands;

PRAGMA foreign_keys = ON;

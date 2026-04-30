CREATE TABLE IF NOT EXISTS saved_bands (
  id TEXT PRIMARY KEY,
  musicbrainz_artist_id TEXT NOT NULL,
  name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  categories TEXT[] NOT NULL DEFAULT '{}',
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saved_bands_name ON saved_bands (name);
CREATE INDEX IF NOT EXISTS idx_saved_bands_updated_at ON saved_bands (updated_at DESC);

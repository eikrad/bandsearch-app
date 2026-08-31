-- Track whether a saved band's note is the user's own words or still the
-- model's pre-filled explanation of why it recommended the artist.
--
-- ADR 0002 / #166: only a user-edited note may reach the recommendation
-- prompt. The stored text alone cannot tell the two apart, so this column
-- carries that fact through storage. Existing rows default to 0 (not edited)
-- — correct, since none of them have been through the edit path this adds.
--
-- A plain ADD COLUMN, not a table rebuild: unlike 003 (which changed a CHECK
-- constraint SQLite cannot alter in place), this only adds a column with a
-- default, which both SQLite and Turso/libSQL support directly.

ALTER TABLE saved_bands ADD COLUMN note_edited INTEGER NOT NULL DEFAULT 0;

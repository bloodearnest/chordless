-- What a person keeps for themselves, synced through their own account (docs/CENTRAL_STORAGE.md, step 5; the model
-- is docs/PERSONAL_LAYER.md): a setlist's overlay (their capo, tuning, sections shown, private annotations, the songs
-- they added for themselves), a song's overlay (the capo, sections and pad set they chose for it), and the settings
-- that describe the person and not the device. Each is the person's alone: it is read and written only by its own
-- account, and never cached by anything shared. A kind of record each, with the document in a JSON `body` (it is
-- never filtered or joined by: docs/SCHEMA_RULES.md). Additive: three new tables.
--
-- A setlist's overlay goes with the setlist (its row), and a song's with the song in its library. When a person
-- leaves a church the Worker removes their overlays of that church's setlists (the rows are theirs, not the church's).
CREATE TABLE setlist_overlays (
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  setlist_id TEXT NOT NULL REFERENCES setlists (setlist_id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (json_valid(body) AND json_type(body) = 'object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  modified_at TEXT NOT NULL,
  PRIMARY KEY (account_id, setlist_id)
) STRICT;

CREATE INDEX setlist_overlays_setlist ON setlist_overlays (setlist_id);

CREATE TABLE song_overlays (
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  library_id TEXT NOT NULL,
  song_uuid TEXT NOT NULL,
  body TEXT NOT NULL CHECK (json_valid(body) AND json_type(body) = 'object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  modified_at TEXT NOT NULL,
  PRIMARY KEY (account_id, library_id, song_uuid),
  FOREIGN KEY (library_id, song_uuid) REFERENCES library_songs (library_id, song_uuid) ON DELETE CASCADE
) STRICT;

CREATE INDEX song_overlays_song ON song_overlays (library_id, song_uuid);

CREATE TABLE account_preferences (
  account_id TEXT NOT NULL PRIMARY KEY REFERENCES accounts (account_id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (json_valid(body) AND json_type(body) = 'object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  modified_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER setlist_overlays_version BEFORE UPDATE ON setlist_overlays
WHEN NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'stale_version');
END;

CREATE TRIGGER song_overlays_version BEFORE UPDATE ON song_overlays
WHEN NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'stale_version');
END;

CREATE TRIGGER account_preferences_version BEFORE UPDATE ON account_preferences
WHEN NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'stale_version');
END;

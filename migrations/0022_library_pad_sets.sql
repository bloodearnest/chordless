-- Pad sets belong to a library, a church's or a person's own, not to a team (docs/CENTRAL_STORAGE.md, step 6): the audio
-- is under the library in R2 (`library/<library_id>/pads/<pad_set_id>/<key>.mp3`) and this is the list of the sets, with
-- their names. A set's id is what a person's choice of pads names (a song's, a setlist's), so it must be the same on every
-- device. Nothing is carried over from Drive or from `space_pad_sets`: the owner reloads them. Additive: a new table.
CREATE TABLE library_pad_sets (
  library_id TEXT NOT NULL REFERENCES libraries (library_id) ON DELETE CASCADE,
  pad_set_id TEXT NOT NULL CHECK (pad_set_id <> ''),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  modified_at TEXT NOT NULL,
  PRIMARY KEY (library_id, pad_set_id),
  UNIQUE (library_id, name)
) STRICT;

CREATE TRIGGER library_pad_sets_version BEFORE UPDATE ON library_pad_sets
WHEN NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'stale_version');
END;

-- Church teams keep setlists separately from the legacy Drive-backed space data.
-- Songs are one ordered JSON document, including per-entry key and other metadata.
CREATE TABLE team_setlists (
  space_id TEXT NOT NULL REFERENCES teams (space_id) ON DELETE CASCADE,
  setlist_id TEXT NOT NULL UNIQUE CHECK (setlist_id <> ''),
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  time TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  -- Deleting an account must first preserve its historical leader name and unlink it explicitly.
  leader_id TEXT REFERENCES accounts (account_id) ON DELETE RESTRICT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(body) AND json_type(body) = 'object'),
  songs TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(songs) AND json_type(songs) = 'array'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  modified_at TEXT NOT NULL,
  PRIMARY KEY (space_id, setlist_id)
) STRICT;
CREATE INDEX team_setlists_date ON team_setlists (space_id, date);
CREATE INDEX team_setlists_leader ON team_setlists (leader_id);
CREATE TRIGGER team_setlists_version BEFORE UPDATE ON team_setlists
WHEN NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'stale_version');
END;

-- A setlist is owned by a team (a church's) or by a person (their own, in their personal space): one of
-- space_id and account_id is set, as libraries has church_id or account_id. So the table is `setlists`, keyed
-- by the setlist alone (its id was already unique). Which library its songs come from is not stored: it is the
-- team's church's, or the person's own, and the Worker checks the songs against it. The Worker also keeps a
-- team to a church that has one (SQLite cannot CHECK across tables).
-- team_setlists is rebuilt, not altered: its key and a foreign key change (docs/SCHEMA_RULES.md).
CREATE TABLE setlists (
  setlist_id TEXT PRIMARY KEY CHECK (setlist_id <> ''),
  space_id TEXT REFERENCES teams (space_id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts (account_id) ON DELETE CASCADE,
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
  CHECK ((space_id IS NOT NULL) <> (account_id IS NOT NULL))
) STRICT;

INSERT INTO setlists (setlist_id, space_id, date, time, type, name, leader_id, created_by, created_at, body, songs, version, modified_at)
SELECT setlist_id, space_id, date, time, type, name, leader_id, created_by, created_at, body, songs, version, modified_at
FROM team_setlists;

DROP TABLE team_setlists;

CREATE INDEX setlists_team_date ON setlists (space_id, date);
CREATE INDEX setlists_account_date ON setlists (account_id, date);
CREATE INDEX setlists_leader ON setlists (leader_id);
CREATE TRIGGER setlists_version BEFORE UPDATE ON setlists
WHEN NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'stale_version');
END;

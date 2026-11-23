-- A setlist belongs to a library, not to a team: a church's setlists are in its shared library and
-- belong to one of its teams, and a person's own will be in their personal library, with no team. So
-- the table is `setlists`, keyed by the setlist alone (its id was already unique), with the library
-- it is in (its songs must be in it too) and the team, which is NULL when it has none. The Worker
-- keeps a church's setlist to a team and a personal one to none (SQLite cannot CHECK across tables).
-- team_setlists is rebuilt, not altered: its key and a foreign key change. A team with no church
-- library would put NULL in library_id and stop the migration, which undoes it (docs/SCHEMA_RULES.md).
CREATE TABLE setlists (
  setlist_id TEXT PRIMARY KEY CHECK (setlist_id <> ''),
  library_id TEXT NOT NULL REFERENCES libraries (library_id) ON DELETE CASCADE,
  space_id TEXT REFERENCES teams (space_id) ON DELETE CASCADE,
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
  modified_at TEXT NOT NULL
) STRICT;

INSERT INTO setlists (setlist_id, library_id, space_id, date, time, type, name, leader_id, created_by, created_at, body, songs, version, modified_at)
SELECT s.setlist_id, l.library_id, s.space_id, s.date, s.time, s.type, s.name, s.leader_id, s.created_by, s.created_at, s.body, s.songs, s.version, s.modified_at
FROM team_setlists s
JOIN teams t ON t.space_id = s.space_id
LEFT JOIN libraries l ON l.church_id = t.church_id;

DROP TABLE team_setlists;

CREATE INDEX setlists_library_date ON setlists (library_id, date);
CREATE INDEX setlists_team_date ON setlists (space_id, date);
CREATE INDEX setlists_leader ON setlists (leader_id);
CREATE TRIGGER setlists_version BEFORE UPDATE ON setlists
WHEN NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'stale_version');
END;

-- A space's data in D1: its songs (the index only), setlists, the songs of a setlist, people and pad sets
-- (docs/D1_PHASE1_PLAN.md, "Space data and its sync"; docs/D1_SCHEMA.md). One table for each kind of record, with
-- real columns for what is looked up, and a JSON column only for what never is. **No song content**: no
-- ChordPro, MusicXML, lyrics or chords, which stay on the device and in the space's Drive (CLAUDE.md).
--
-- Additive: new tables, and one column on `teams`. Written to docs/SCHEMA_RULES.md.
--
-- A write is refused if it was made from an out-of-date record, by the table itself: a record's `version` can only move
-- to the next one (a trigger on each table, below), so a change that names a version the row has since left aborts the
-- statement, and with it the batch that holds it (D1 undoes a batch if a statement fails). The Worker's writes carry the
-- version they expect to find plus one (worker/src/space-data.ts).
--
-- There are no tombstones and no change feed: a space's data is read whole, and a record that is gone is a missing
-- row. `version` is only there to refuse a write that was made from an out-of-date row (409); `modified_at`
-- is for people, the ETag and reports. The keys of a table start with the space, so a space's rows sit together.

-- Where a team's setlists, people and song index are kept: 'drive' until the owner moves it (docs/D1_PHASE1_PLAN.md,
-- step 3), then 'd1'. The column and the Drive path for these collections are removed once both teams have moved.
ALTER TABLE teams ADD COLUMN storage TEXT NOT NULL DEFAULT 'drive' CHECK (storage IN ('drive', 'd1'));

-- The song index: who a space's songs are, not what they say. `licence` is the CCLI licence number the chart came in
-- under (docs/CCLI.md). `file_ref` is the Drive file that holds the chart, where there is one.
CREATE TABLE space_songs (
  space_id TEXT NOT NULL REFERENCES teams (space_id) ON DELETE CASCADE,
  song_uuid TEXT NOT NULL,
  song_id TEXT NOT NULL,
  title TEXT NOT NULL,
  ccli TEXT,
  song_key TEXT,
  licence TEXT,
  is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
  variant_of TEXT,
  variant_label TEXT NOT NULL DEFAULT '',
  content_hash TEXT,
  file_ref TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  modified_at TEXT NOT NULL,
  PRIMARY KEY (space_id, song_uuid)
) STRICT;

CREATE TRIGGER space_songs_version BEFORE UPDATE ON space_songs
WHEN NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'stale_version');
END;

-- A setlist. `setlist_id` is unique across spaces (the app finds a setlist's space from its id alone), and is a
-- key of its own for that reason. `body` holds the rest of the record (what is shared by link, and so on): a JSON object.
CREATE TABLE space_setlists (
  space_id TEXT NOT NULL REFERENCES teams (space_id) ON DELETE CASCADE,
  setlist_id TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  time TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  leader_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(body) AND json_type(body) = 'object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  modified_at TEXT NOT NULL,
  PRIMARY KEY (space_id, setlist_id)
) STRICT;

CREATE INDEX space_setlists_date ON space_setlists (space_id, date);

CREATE TRIGGER space_setlists_version BEFORE UPDATE ON space_setlists
WHEN NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'stale_version');
END;

-- The songs of a setlist, in order. `title` and `ccli` are copied from the song so that a setlist can be read on a
-- device that does not have it (docs/CENTRAL_STORAGE.md). `extra` is the rest of the entry, a JSON object.
CREATE TABLE space_setlist_songs (
  setlist_id TEXT NOT NULL REFERENCES space_setlists (setlist_id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  song_uuid TEXT NOT NULL,
  song_id TEXT NOT NULL,
  title TEXT NOT NULL,
  ccli TEXT,
  song_key TEXT,
  tempo INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  annotations TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(annotations) AND json_type(annotations) = 'array'),
  extra TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra) AND json_type(extra) = 'object'),
  PRIMARY KEY (setlist_id, position)
) STRICT, WITHOUT ROWID;

-- The people of a space (who can lead a setlist), as docs/IDENTITIES.md has them: `emails` is a JSON array of
-- lower-case addresses.
CREATE TABLE space_people (
  space_id TEXT NOT NULL REFERENCES teams (space_id) ON DELETE CASCADE,
  person_id TEXT NOT NULL,
  name TEXT NOT NULL,
  emails TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(emails) AND json_type(emails) = 'array'),
  team_member TEXT,
  merged_into TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  modified_at TEXT NOT NULL,
  PRIMARY KEY (space_id, person_id)
) STRICT;

CREATE TRIGGER space_people_version BEFORE UPDATE ON space_people
WHEN NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'stale_version');
END;

-- The pad sets of a space (their audio is not here).
CREATE TABLE space_pad_sets (
  space_id TEXT NOT NULL REFERENCES teams (space_id) ON DELETE CASCADE,
  pad_set_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  modified_at TEXT NOT NULL,
  PRIMARY KEY (space_id, pad_set_id)
) STRICT;

CREATE TRIGGER space_pad_sets_version BEFORE UPDATE ON space_pad_sets
WHEN NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'stale_version');
END;

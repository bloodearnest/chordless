-- The register of teams (worker/src/team-register.ts, docs/SPACES.md, "SongSelect's terms"): which
-- teams use Chordless, who owns them and which CCLI licence they say they hold, for compliance
-- (CCLI may ask) and perhaps for charging. It outlives a team: sharing ending marks a row, never
-- removes it. Only what the Worker already holds for a team, and never a title, a lyric, a chart or
-- a member's address: song and pad content is not kept here (CLAUDE.md, "Spaces and copyright").
-- Rolled forward only: a change is a new file here (docs/MIGRATIONS.md).

CREATE TABLE teams (
  -- The team's id, made by the Worker; the name of its Durable Object
  space_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- Who to ask about the team (its owner's Google address, lower case)
  owner_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- The licence number as it stands (null if none): the changes are in team_events
  ccli_licence TEXT,
  -- How many people are in it now, the owner included (null if not yet counted)
  members INTEGER,
  -- When sharing ended (null while it is shared)
  ended_at TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX teams_ccli_licence ON teams (ccli_licence);
CREATE INDEX teams_owner_email ON teams (owner_email);

-- What happened to a team, added to and never changed
CREATE TABLE team_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id TEXT NOT NULL,
  at TEXT NOT NULL,
  -- 'created', 'licence' (set, changed or cleared) or 'ended'
  kind TEXT NOT NULL,
  -- The account that did it
  by_email TEXT,
  -- JSON: for a licence, {"from": ..., "to": ...}
  detail TEXT
) STRICT;

CREATE INDEX team_events_space ON team_events (space_id, id);

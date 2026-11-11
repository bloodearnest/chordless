-- A team space's state moves from its Durable Object to D1 (worker/src/team-state.ts, docs/SPACES.md):
-- who owns it, who its members are, its invites, the Drive files in its tree, and how the Worker
-- reaches its folder. One place for it, which can be asked across teams ("which teams is this person
-- in?"), and the register above is no longer a copy of it: `teams` IS the team, and `team_events`
-- its history. The Durable Object keeps only the live sockets.
-- Nothing is migrated: no team existed in production. Additive for the Worker before it, which
-- ignores these, apart from `members`, a snapshot nothing else reads (the count is now counted).

ALTER TABLE teams ADD COLUMN root_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE teams ADD COLUMN owner_provider TEXT NOT NULL DEFAULT '';
ALTER TABLE teams ADD COLUMN owner_sub TEXT NOT NULL DEFAULT '';
-- How the Worker reaches the folder: 'owner' (their sign-in, in team_credentials) or 'service-account'
ALTER TABLE teams ADD COLUMN credential TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE teams DROP COLUMN members;

-- The members other than the owner, who is in `teams`. identity is `provider:sub`: the account is
-- the member, the email is for showing and for matching an invite
CREATE TABLE team_members (
  space_id TEXT NOT NULL,
  identity TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  since TEXT NOT NULL,
  PRIMARY KEY (space_id, identity)
) STRICT, WITHOUT ROWID;

CREATE INDEX team_members_identity ON team_members (identity);
CREATE INDEX team_members_email ON team_members (space_id, email);

-- Open invites. id is the hash of the code, which is a secret and so is not kept
CREATE TABLE team_invites (
  space_id TEXT NOT NULL,
  id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (space_id, id)
) STRICT, WITHOUT ROWID;

-- The Drive files known to be in the team's tree (ids only: no name, no content)
CREATE TABLE team_refs (
  space_id TEXT NOT NULL,
  ref TEXT NOT NULL,
  PRIMARY KEY (space_id, ref)
) STRICT, WITHOUT ROWID;

-- The owner's Google refresh token, encrypted with the Worker's key; apart from `teams`, so a query
-- about teams never selects it. A team on the service account has no row.
CREATE TABLE team_credentials (
  space_id TEXT PRIMARY KEY,
  blob TEXT NOT NULL
) STRICT;

-- Accounts: a person's Chordless account holds the ways they sign in (a login: a provider and its id for
-- them) and the addresses they are known by, and a team's membership refers to the account, not to one
-- login. Today a member is one Google login with one email, so one person on two Google accounts is two
-- members. This is what a later sign-in with Microsoft, Apple or an emailed link attaches to.
--
-- Only additive: the Worker deployed before this one must carry on against it if a deploy is rolled back
-- (docs/CI.md), so team_members.identity and .email and teams.owner_provider, owner_sub and owner_email
-- stay, and the new Worker keeps them right. A later migration drops them once nothing can roll back to
-- a Worker that reads them. Back the database up first (just db-backup: docs/MIGRATIONS.md).
--
-- Holds no song, setlist or pad content (CLAUDE.md, "Spaces and copyright"): who someone is, and how they
-- sign in.

CREATE TABLE accounts (
  account_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
) STRICT, WITHOUT ROWID;

-- The ways to sign in. provider is google now, and later microsoft, apple, or email (an emailed link, with
-- the address as sub). email is what the provider last said it was, lower case.
CREATE TABLE account_identities (
  provider TEXT NOT NULL,
  sub TEXT NOT NULL,
  account_id TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (provider, sub)
) STRICT, WITHOUT ROWID;

CREATE INDEX account_identities_account ON account_identities (account_id);
CREATE INDEX account_identities_email ON account_identities (email);

-- The key of a member and of an owner from here on. Null only for a row the previous Worker made after
-- this ran: the new one fills it in when it next sees them.
ALTER TABLE team_members ADD COLUMN account_id TEXT;
ALTER TABLE teams ADD COLUMN owner_account_id TEXT;

-- The addresses a team knows a member by. Per team on purpose: a team is shown the addresses used with it,
-- not every address the account has elsewhere. source is signin (the provider verified it) or invite (the
-- address an invite was sent to, when they joined with another: a label, never proof).
CREATE TABLE team_member_emails (
  space_id TEXT NOT NULL,
  email TEXT NOT NULL,
  account_id TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (space_id, email)
) STRICT, WITHOUT ROWID;

CREATE INDEX team_member_emails_account ON team_member_emails (space_id, account_id);

-- One account for each login that is a member or an owner now. A scratch table keeps the account and its
-- login agreeing on the id, and goes at the end.
CREATE TABLE _account_backfill (
  provider TEXT NOT NULL,
  sub TEXT NOT NULL,
  email TEXT NOT NULL,
  account_id TEXT NOT NULL,
  PRIMARY KEY (provider, sub)
) STRICT, WITHOUT ROWID;

INSERT OR IGNORE INTO _account_backfill (provider, sub, email, account_id)
  SELECT substr(identity, 1, instr(identity, ':') - 1), substr(identity, instr(identity, ':') + 1), email, lower(hex(randomblob(16)))
  FROM team_members
  WHERE instr(identity, ':') > 0;

INSERT OR IGNORE INTO _account_backfill (provider, sub, email, account_id)
  SELECT owner_provider, owner_sub, owner_email, lower(hex(randomblob(16)))
  FROM teams
  WHERE owner_provider <> '' AND owner_sub <> '';

INSERT INTO accounts (account_id, created_at)
  SELECT account_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM _account_backfill;

INSERT INTO account_identities (provider, sub, account_id, email, created_at, last_seen_at)
  SELECT provider, sub, account_id, email, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM _account_backfill;

UPDATE team_members SET account_id = (
  SELECT b.account_id FROM _account_backfill b WHERE b.provider || ':' || b.sub = team_members.identity
);

UPDATE teams SET owner_account_id = (
  SELECT b.account_id FROM _account_backfill b WHERE b.provider = teams.owner_provider AND b.sub = teams.owner_sub
)
WHERE owner_provider <> '' AND owner_sub <> '';

INSERT OR IGNORE INTO team_member_emails (space_id, email, account_id, source)
  SELECT space_id, email, account_id, 'signin' FROM team_members WHERE account_id IS NOT NULL;

DROP TABLE _account_backfill;

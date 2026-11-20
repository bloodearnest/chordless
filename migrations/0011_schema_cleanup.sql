-- Clean up the schema (docs/SCHEMA_AUDIT.md): foreign keys, NOT NULL where a value is required, CHECKs for the
-- closed sets, the indexes the queries use, team members keyed by account, and nothing spelt '' for "not set".
--
-- NOT additive: the Worker before this one cannot run on this schema, nor this one before it. Deploy the
-- migration and the Worker together, not on a Sunday, after `just db-backup`. It fails (and rolls back) rather
-- than lose or guess at data: a team member with no account, two logins of one account in one team, an owner
-- login that is empty, a timestamp that is not ISO 8601. Run the queries in docs/SCHEMA_AUDIT.md, section 6,
-- first.
--
-- How: each table is rebuilt under a temporary name (`x_v2`) with its foreign keys pointing at the other `_v2`
-- tables, parents are copied before children, the old tables are dropped (nothing references them: they had no
-- foreign keys), and each `_v2` is renamed, which makes SQLite rewrite the references to the final names. Tried
-- on a local D1 before this was written.
--
-- Timestamps stay one format by convention, UTC ISO 8601 with a Z (`2026-11-20T09:30:00.000Z`, from toISOString()
-- and strftime alike); they are not CHECKed.

PRAGMA defer_foreign_keys = on;

-- ---------------------------------------------------------------------------------------------------------
-- The new tables

-- Emailed sign-in codes and links (migrations 0005, 0006). The link, the address and the code are set by every
-- request for a code, so they are required; only `next` (the page to go on to) is optional. The address and the code
-- are kept readable until used or run out, three days at most (docs/SECURITY.md). Nothing refers to it.
CREATE TABLE login_codes_v2 (
  address_hash TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  window_start TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 1 CHECK (sent >= 1),
  link_hash TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL CHECK (address = lower(address)),
  code TEXT NOT NULL,
  next TEXT
) STRICT, WITHOUT ROWID;

CREATE TABLE accounts_v2 (
  account_id TEXT PRIMARY KEY,
  name TEXT,
  created_at TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE account_identities_v2 (
  provider TEXT NOT NULL,
  sub TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts_v2 (account_id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (provider, sub)
) STRICT, WITHOUT ROWID;

CREATE TABLE account_emails_v2 (
  email TEXT PRIMARY KEY CHECK (email = lower(email)),
  account_id TEXT NOT NULL REFERENCES accounts_v2 (account_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE account_drive_v2 (
  account_id TEXT PRIMARY KEY REFERENCES accounts_v2 (account_id) ON DELETE CASCADE,
  blob TEXT NOT NULL,
  google_email TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE sessions_v2 (
  session_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts_v2 (account_id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  previous_hash TEXT,
  rotated_at TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT, WITHOUT ROWID;

-- A team is never deleted (the register outlives it: name, owner, dates). Its owner's account may be: an ended
-- team then has no owner account. A team that is live must have one, so an account that owns a live team cannot
-- be deleted until the team is ended or handed on (docs/ACCOUNT.md).
CREATE TABLE teams_v2 (
  space_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_account_id TEXT REFERENCES accounts_v2 (account_id) ON DELETE SET NULL,
  owner_email TEXT NOT NULL CHECK (owner_email = lower(owner_email)),
  -- the owner's login that holds the team's Drive credential (team_credentials), checked against it
  owner_provider TEXT NOT NULL CHECK (owner_provider <> ''),
  owner_sub TEXT NOT NULL CHECK (owner_sub <> ''),
  ccli_licence TEXT,
  root_ref TEXT,
  credential TEXT NOT NULL DEFAULT 'owner' CHECK (credential IN ('owner', 'service-account')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT,
  CHECK (ended_at IS NOT NULL OR owner_account_id IS NOT NULL)
) STRICT;

-- A member is an account. `invited_as` is the address an invite was made out to, when the person signed in as
-- another: it is kept as theirs, so the people who know them by it still do (it was team_member_emails' 'invite' rows).
-- Every other address of a member is the account's (account_emails).
CREATE TABLE team_members_v2 (
  space_id TEXT NOT NULL REFERENCES teams_v2 (space_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts_v2 (account_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'writer', 'reader')),
  invited_as TEXT CHECK (invited_as IS NULL OR invited_as = lower(invited_as)),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (space_id, account_id)
) STRICT, WITHOUT ROWID;

-- `created_by` stays an address: it is shown as one, and an invite is short-lived.
CREATE TABLE team_invites_v2 (
  space_id TEXT NOT NULL REFERENCES teams_v2 (space_id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  email TEXT NOT NULL CHECK (email = lower(email)),
  role TEXT NOT NULL CHECK (role IN ('admin', 'writer', 'reader')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  emailed_at TEXT,
  PRIMARY KEY (space_id, id)
) STRICT, WITHOUT ROWID;

CREATE TABLE team_refs_v2 (
  space_id TEXT NOT NULL REFERENCES teams_v2 (space_id) ON DELETE CASCADE,
  ref TEXT NOT NULL,
  PRIMARY KEY (space_id, ref)
) STRICT, WITHOUT ROWID;

CREATE TABLE team_credentials_v2 (
  space_id TEXT PRIMARY KEY REFERENCES teams_v2 (space_id) ON DELETE CASCADE,
  blob TEXT NOT NULL
) STRICT;

-- `by_email` stays an address, not a key: the log outlives accounts (CCLI may ask who changed a licence).
CREATE TABLE team_events_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id TEXT NOT NULL REFERENCES teams_v2 (space_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  by_email TEXT,
  detail TEXT
) STRICT;

-- ---------------------------------------------------------------------------------------------------------
-- Copy, parents first. A row that breaks a constraint stops the migration, which is undone as a whole.

-- (a row from before 0006 has no link or address: it ran out days ago, and could not be used)
INSERT INTO login_codes_v2 (address_hash, code_hash, created_at, expires_at, attempts, window_start, sent,
                            link_hash, address, code, next)
  SELECT address_hash, code_hash, created_at, expires_at, attempts, window_start, sent,
         link_hash, address, code, next
  FROM login_codes WHERE link_hash IS NOT NULL AND address IS NOT NULL AND code IS NOT NULL;

INSERT INTO accounts_v2 (account_id, name, created_at)
  SELECT account_id, name, created_at FROM accounts;

INSERT INTO account_identities_v2 (provider, sub, account_id, email, created_at, last_seen_at)
  SELECT provider, sub, account_id, email, created_at, last_seen_at FROM account_identities;

INSERT INTO account_emails_v2 (email, account_id, created_at)
  SELECT email, account_id, created_at FROM account_emails;

INSERT INTO account_drive_v2 (account_id, blob, google_email, scope, created_at, updated_at)
  SELECT account_id, blob, google_email, scope, created_at, updated_at FROM account_drive;

-- (sessions are disposable: one of an account that is gone is dropped, not carried over)
INSERT INTO sessions_v2 (session_id, account_id, email, token_hash, previous_hash, rotated_at, created_at,
                         last_used_at, expires_at, revoked_at)
  SELECT session_id, account_id, email, token_hash, previous_hash, rotated_at, created_at,
         last_used_at, expires_at, revoked_at
  FROM sessions WHERE account_id IN (SELECT account_id FROM accounts);

INSERT INTO teams_v2 (space_id, name, owner_account_id, owner_email, owner_provider, owner_sub, ccli_licence,
                      root_ref, credential, created_at, updated_at, ended_at)
  SELECT space_id, name, owner_account_id, owner_email, owner_provider, owner_sub, ccli_licence,
         NULLIF(root_ref, ''), credential, created_at, updated_at, ended_at
  FROM teams;

-- A member's account is the row's own, else the one of the login it was keyed by (the first login).
INSERT INTO team_members_v2 (space_id, account_id, role, invited_as, joined_at)
  SELECT m.space_id,
         COALESCE(m.account_id,
                  (SELECT i.account_id FROM account_identities i WHERE i.provider || ':' || i.sub = m.identity)),
         m.role,
         (SELECT e.email FROM team_member_emails e
            WHERE e.space_id = m.space_id AND e.account_id = m.account_id AND e.source = 'invite'
            ORDER BY e.email LIMIT 1),
         m.since
  FROM team_members m;

INSERT INTO team_invites_v2 (space_id, id, email, role, created_by, created_at, expires_at, emailed_at)
  SELECT space_id, id, email, role, created_by, created_at, expires_at, emailed_at FROM team_invites;

INSERT INTO team_refs_v2 (space_id, ref) SELECT space_id, ref FROM team_refs;

INSERT INTO team_credentials_v2 (space_id, blob) SELECT space_id, blob FROM team_credentials;

INSERT INTO team_events_v2 (id, space_id, created_at, kind, by_email, detail)
  SELECT id, space_id, at, kind, by_email, detail FROM team_events;

-- ---------------------------------------------------------------------------------------------------------
-- Replace the old tables (their indexes go with them)

DROP TABLE login_codes;
DROP TABLE team_member_emails;
DROP TABLE team_events;
DROP TABLE team_credentials;
DROP TABLE team_refs;
DROP TABLE team_invites;
DROP TABLE team_members;
DROP TABLE teams;
DROP TABLE sessions;
DROP TABLE account_drive;
DROP TABLE account_emails;
DROP TABLE account_identities;
DROP TABLE accounts;

ALTER TABLE login_codes_v2 RENAME TO login_codes;
ALTER TABLE accounts_v2 RENAME TO accounts;
ALTER TABLE account_identities_v2 RENAME TO account_identities;
ALTER TABLE account_emails_v2 RENAME TO account_emails;
ALTER TABLE account_drive_v2 RENAME TO account_drive;
ALTER TABLE sessions_v2 RENAME TO sessions;
ALTER TABLE teams_v2 RENAME TO teams;
ALTER TABLE team_members_v2 RENAME TO team_members;
ALTER TABLE team_invites_v2 RENAME TO team_invites;
ALTER TABLE team_refs_v2 RENAME TO team_refs;
ALTER TABLE team_credentials_v2 RENAME TO team_credentials;
ALTER TABLE team_events_v2 RENAME TO team_events;

-- ---------------------------------------------------------------------------------------------------------
-- The indexes the queries use

CREATE INDEX account_identities_account ON account_identities (account_id);
CREATE INDEX account_identities_email ON account_identities (email);
CREATE INDEX account_emails_account ON account_emails (account_id);
CREATE INDEX sessions_account ON sessions (account_id);
CREATE INDEX sessions_expires ON sessions (expires_at);
CREATE INDEX teams_owner_account ON teams (owner_account_id);
CREATE INDEX teams_owner_email ON teams (owner_email);
CREATE INDEX teams_ccli_licence ON teams (ccli_licence);
CREATE INDEX team_members_account ON team_members (account_id);
CREATE INDEX team_invites_email ON team_invites (email, created_at);
CREATE INDEX team_events_space ON team_events (space_id, id);

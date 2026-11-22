-- Church-wide roles. Existing Team membership stays intact until the controlled migration.
CREATE TABLE church_members (
  church_id TEXT NOT NULL REFERENCES churches (church_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'writer', 'reader')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (church_id, account_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX church_members_account ON church_members (account_id);

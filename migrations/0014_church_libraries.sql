-- Add the church and library identities alongside the existing Team schema. Existing Teams stay
-- Drive-backed and unchanged until the separately controlled move. New IDs are generated as ULIDs
-- by the application; existing IDs are never rewritten. See docs/CHURCH_TEAM_DESIGN.md.
CREATE TABLE churches (
  church_id TEXT PRIMARY KEY CHECK (church_id <> ''),
  name TEXT NOT NULL CHECK (name <> ''),
  country TEXT NOT NULL CHECK (country <> ''),
  city TEXT NOT NULL CHECK (city <> ''),
  postcode TEXT CHECK (postcode IS NULL OR postcode <> ''),
  ccli_licence TEXT CHECK (ccli_licence IS NULL OR ccli_licence <> ''),
  licences TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(licences) AND json_type(licences) = 'object'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT
) STRICT, WITHOUT ROWID;

-- Exactly one owner: a church's shared library or an account's personal library. Partial unique
-- indexes enforce at most one of each; creation must make the library in the same operation.
CREATE TABLE libraries (
  library_id TEXT PRIMARY KEY CHECK (library_id <> ''),
  church_id TEXT REFERENCES churches (church_id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts (account_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  CHECK ((church_id IS NOT NULL) <> (account_id IS NOT NULL))
) STRICT, WITHOUT ROWID;

CREATE UNIQUE INDEX libraries_church ON libraries (church_id) WHERE church_id IS NOT NULL;
CREATE UNIQUE INDEX libraries_account ON libraries (account_id) WHERE account_id IS NOT NULL;

-- Nullable during preparation: existing clients and Drive-backed Teams continue unchanged.
ALTER TABLE teams ADD COLUMN church_id TEXT REFERENCES churches (church_id) ON DELETE RESTRICT;
CREATE INDEX teams_church ON teams (church_id);

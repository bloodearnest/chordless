-- Sign-in codes: a person asks for a code to be emailed to an address, and types it to sign in with no
-- Google account (docs/SPACES.md, "Signing in without Google"). One row for each address that has a code out.
--
-- Holds neither the address nor the code: address_hash and code_hash are keyed hashes (SESSION_SIGNING_KEY),
-- so the table says nothing to someone who reads it. The address is kept in account_identities, and only
-- once the person has proved they can read mail sent to it.
--
-- window_start and sent count the codes sent to the address in the last hour (at most five), so that a
-- stranger cannot use Chordless to fill someone's inbox. Only additive: the Worker before this one carries on
-- without the table (it has no email sign-in). Back the database up first (just db-backup).

CREATE TABLE login_codes (
  address_hash TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 1
) STRICT, WITHOUT ROWID;

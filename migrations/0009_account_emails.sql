-- The addresses an account owns, one account to an address. Until now an address was only a column on a login
-- (account_identities.email), so two accounts could hold the same one, and which a sign-in found was
-- ORDER BY created_at LIMIT 1. A login is a way to sign in; an address is who the person is, and it belongs to
-- one account: the primary key is what says so, and what makes two first sign-ins at once safe (the second
-- claim is refused, and it joins the account that has the address).
--
-- Only verified addresses are claimed (Google said it verified it, or an emailed code proved it): an
-- address a provider did not vouch for would let someone take over an account by naming it.
--
-- Only additive: account_identities.email stays (the Worker before this one reads it, if a deploy is rolled
-- back: docs/CI.md). Back the database up first (just db-backup: docs/MIGRATIONS.md). If two accounts held
-- one address, the older login's account keeps it; the other keeps its login and does not own the address.
--
-- Holds no song, setlist or pad content (CLAUDE.md, "Spaces and copyright"): the addresses people are known by.

CREATE TABLE account_emails (
  email TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE INDEX account_emails_account ON account_emails (account_id);

INSERT OR IGNORE INTO account_emails (email, account_id, created_at)
  SELECT email, account_id, created_at
  FROM account_identities
  WHERE email <> ''
  ORDER BY created_at, provider, sub;

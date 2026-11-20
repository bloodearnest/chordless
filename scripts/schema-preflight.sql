-- Before migrations/0011_schema_cleanup.sql is applied to a database: what in it would make that migration stop.
-- Read-only (SELECTs only). Every row says what it counts (`what`), how many there are (`n`), and what is wanted
-- (`wanted`: "0", or "info" for a count that is only worth a look). The migration refuses a bad row rather than guess,
-- and is undone whole when it does, so a non-zero here is not damage: it is what to put right first, or to decide about.
--
--   npx wrangler d1 execute chordless-teams --remote --file scripts/schema-preflight.sql
--
-- (docs/SCHEMA_AUDIT.md, section 6. For the schema before 0011: it does not run on the one after it. D1 allows only five
-- terms in a compound SELECT, so these are several statements, each answered on its own.)

-- 1. Who is a member, and who owns a team
SELECT 'members with no account (not on the row, nor through their login)' AS what, count(*) AS n, '0' AS wanted
  FROM team_members m
  WHERE m.account_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM account_identities i WHERE i.provider || ':' || i.sub = m.identity)
UNION ALL SELECT 'accounts that are two members of one team', count(*), '0' FROM (
  SELECT m.space_id,
         COALESCE(m.account_id, (SELECT i.account_id FROM account_identities i WHERE i.provider || ':' || i.sub = m.identity)) AS account
    FROM team_members m GROUP BY 1, 2 HAVING count(*) > 1)
UNION ALL SELECT 'teams with an empty owner login (owner_provider or owner_sub)', count(*), '0'
  FROM teams WHERE owner_provider = '' OR owner_sub = ''
UNION ALL SELECT 'live teams with no owner account', count(*), '0'
  FROM teams WHERE ended_at IS NULL AND owner_account_id IS NULL;

-- 2. Values the migration CHECKs
SELECT 'member roles that are not admin, writer or reader' AS what, count(*) AS n, '0' AS wanted
  FROM team_members WHERE role NOT IN ('admin', 'writer', 'reader')
UNION ALL SELECT 'invite roles that are not admin, writer or reader', count(*), '0'
  FROM team_invites WHERE role NOT IN ('admin', 'writer', 'reader')
UNION ALL SELECT 'teams whose credential is not owner or service-account', count(*), '0'
  FROM teams WHERE credential NOT IN ('owner', 'service-account')
UNION ALL SELECT 'owner emails not in lower case', count(*), '0'
  FROM teams WHERE owner_email <> lower(owner_email)
UNION ALL SELECT 'invite emails not in lower case', count(*), '0'
  FROM team_invites WHERE email <> lower(email);

SELECT 'account emails not in lower case' AS what, count(*) AS n, '0' AS wanted
  FROM account_emails WHERE email <> lower(email)
UNION ALL SELECT 'invited-as labels not in lower case', count(*), '0'
  FROM team_member_emails WHERE source = 'invite' AND email <> lower(email)
UNION ALL SELECT 'sign-in links shared by two codes', count(*), '0' FROM (
  SELECT link_hash FROM login_codes WHERE link_hash IS NOT NULL GROUP BY link_hash HAVING count(*) > 1)
UNION ALL SELECT 'sign-in codes whose address is not in lower case, or whose counters are out of range', count(*), '0'
  FROM login_codes WHERE link_hash IS NOT NULL AND address IS NOT NULL AND code IS NOT NULL
    AND (address <> lower(address) OR attempts < 0 OR sent < 1);

-- 3. Rows that would break a foreign key (nothing had one: a row can point at what is gone)
SELECT 'logins of an account that is not there' AS what, count(*) AS n, '0' AS wanted
  FROM account_identities WHERE account_id NOT IN (SELECT account_id FROM accounts)
UNION ALL SELECT 'addresses of an account that is not there', count(*), '0'
  FROM account_emails WHERE account_id NOT IN (SELECT account_id FROM accounts)
UNION ALL SELECT 'Drive connections of an account that is not there', count(*), '0'
  FROM account_drive WHERE account_id NOT IN (SELECT account_id FROM accounts)
UNION ALL SELECT 'teams whose owner account is not there', count(*), '0'
  FROM teams WHERE owner_account_id IS NOT NULL AND owner_account_id NOT IN (SELECT account_id FROM accounts)
UNION ALL SELECT 'members whose account is not there', count(*), '0'
  FROM team_members WHERE account_id IS NOT NULL AND account_id NOT IN (SELECT account_id FROM accounts);

SELECT 'members, invites, refs, credentials or events of a team that is not there' AS what, count(*) AS n, '0' AS wanted FROM (
  SELECT space_id FROM team_members UNION ALL SELECT space_id FROM team_invites UNION ALL SELECT space_id FROM team_refs
  UNION ALL SELECT space_id FROM team_credentials UNION ALL SELECT space_id FROM team_events)
  WHERE space_id NOT IN (SELECT space_id FROM teams);

-- 4. Not a stop: what the migration drops or changes, and how much there is
SELECT 'info: sessions of an account that is gone (dropped)' AS what, count(*) AS n, 'info' AS wanted
  FROM sessions WHERE account_id NOT IN (SELECT account_id FROM accounts)
UNION ALL SELECT 'info: sign-in codes from before links (dropped)', count(*), 'info'
  FROM login_codes WHERE link_hash IS NULL OR address IS NULL OR code IS NULL
UNION ALL SELECT 'info: members with more than one address an invite named (the first is kept)', count(*), 'info' FROM (
  SELECT space_id, account_id FROM team_member_emails WHERE source = 'invite' GROUP BY 1, 2 HAVING count(*) > 1)
UNION ALL SELECT 'info: teams with no Drive folder linked (root_ref empty: becomes NULL)', count(*), 'info'
  FROM teams WHERE root_ref = ''
UNION ALL SELECT 'info: live teams', count(*), 'info' FROM teams WHERE ended_at IS NULL;

SELECT 'info: ended teams' AS what, count(*) AS n, 'info' AS wanted FROM teams WHERE ended_at IS NOT NULL
UNION ALL SELECT 'info: members', count(*), 'info' FROM team_members
UNION ALL SELECT 'info: accounts', count(*), 'info' FROM accounts;

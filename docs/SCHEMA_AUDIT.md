# Audit of the D1 schema (2026-11-20)

**Status: findings, the owner's decisions on them (section 7), and a proposal; no migration written.** Read from `migrations/0001` to `0010` and the Worker
code that uses each table, and checked against a local D1 with those migrations applied (`PRAGMA table_list`,
`foreign_key_list`, the indexes). **Production was not looked at**: it may have drifted (manual fixes, rows
that migration 0003's backfill missed). Section 6 lists what to run against it before any migration.

## 1. What D1 lets us do

D1 is SQLite on Cloudflare ([Cloudflare's SQL statements and foreign keys pages](https://developers.cloudflare.com/d1/sql-api/sql-statements/)).

- **PRAGMA: a subset.** Supported: `table_list`, `table_info`, `table_xinfo`, `index_list`, `index_info`,
  `index_xinfo`, `quick_check`, `foreign_key_check`, `foreign_key_list`, `foreign_keys`, `defer_foreign_keys`,
  `case_sensitive_like`, `ignore_check_constraints`, `legacy_alter_table`, `recursive_triggers`,
  `reverse_unordered_selects`, `optimize` (not `optimize(-1)`). There is no way to configure the database
  with settings that persist: **a PRAGMA applies to the current transaction only**.
- **Foreign keys are on by default**, "identical to `PRAGMA foreign_keys = on` for every transaction"
  (confirmed locally: `foreign_keys = 1`). Cloudflare's two pages disagree about whether a migration can turn
  that off, so the plan below does not need it. `defer_foreign_keys = on` postpones the check to the end of the
  transaction, and `ON DELETE CASCADE` still runs while it is deferred.
- **`STRICT`, `WITHOUT ROWID` and `CHECK` work** (the pages do not discuss them; the schema already uses the first
  two, and `table_list` reports a `strict` flag per table).
- **Every table is already `STRICT`**: 13 of 13 (14 `CREATE TABLE`, one temporary and dropped). The `ALTER TABLE ADD
  COLUMN`s kept it.
- **Rebuilding a table works, without turning foreign keys off.** Tested locally (a throwaway schema, two
  tables): create all the new tables under temporary names (`x_v2`) with their foreign keys pointing at the
  `_v2` parents, copy parents first, drop the old tables (nothing references them, because they have no foreign
  keys), then rename each `_v2` to its final name. SQLite rewrites the children's references on the rename. Rows,
  `STRICT`, `WITHOUT ROWID` and `ON DELETE CASCADE` all came through, `foreign_key_check` was empty. The same must be
  rehearsed on a copy of production's data before it is used on production.

## 2. Findings

Ranked: **A** is what makes the schema untrustworthy, **B** and **C** are what the owner asked about, **D** to **G**
are tidying.

**A. No foreign keys anywhere.** `foreign_key_list` is empty for all 13 tables. Every `account_id` and `space_id`
is a loose string, so an orphan row is possible, and code does the cascades by hand (`destroy()` in
`team-state.ts` deletes five tables' rows one by one).

**B. Team members do not really link to accounts.** `team_members` is keyed `(space_id, identity)`, where
`identity` is `provider:sub` of the member's *first login*. `account_id` was added in 0003 as a **nullable** column
and backfilled, so it is empty for any row the backfill missed, and the code still matches `m.identity = ? OR
m.account_id = acct.id` (`team-state.ts`, lines about 318 to 330, 436 to 445, 506, 578, 602). `email` sits beside
it. A person with a Google login and an emailed-link login is one account but two identities, and that is the
confusion the migration was about. `teams.owner_account_id` is nullable for the same reason.

**C. Empty-string sentinels and nullable columns that should be required.** `teams.root_ref`,
`teams.owner_provider` and `teams.owner_sub` are `NOT NULL DEFAULT ''`: "unset" is spelt `''`, which `STRICT`
cannot tell from a value. `team_members.account_id` and `teams.owner_account_id` (B). `login_codes` has four
nullable columns added later (`link_hash`, `address`, `code`, `next`) that every current row uses.

**D. Free text where there is a closed set, and no `CHECK` anywhere.** `team_members.role` and
`team_invites.role` (`admin | writer | reader`; the owner is `teams.owner_account_id`, not a member row),
`teams.credential` (`owner | service-account`), `team_member_emails.source` (`'signin'` or `'invite'`),
`team_events.kind` (`created | joined_as_other | ended | licence`), `account_identities.provider` (`google | email`; the session provider is never stored there). A typo becomes a row. Emails are lowercased by the code, not by the schema.

**E. Duplicated or derivable data.**
- `team_members.identity` and `.email` (B), and the index on `identity`.
- `team_member_emails (space_id, email) -> account_id`: written whenever a member signs in, read to find a member
  by address. `account_emails (email PK) -> account_id` already says which account owns an address, so it is
  derivable by joining that to `team_members`. **Decided (the owner): redundant, dropped.** The queries that read it
  (`team-state.ts`, around lines 458 and 605) join `account_emails` instead.
- `teams.owner_provider` and `owner_sub` (the owner's Google login) next to `owner_account_id`. They are read to
  decide who is the owner (`team-state.ts` line 318) and, in `team-drive.ts` line 73, to check that the credential
  blob in `team_credentials` was made by that login. **Decided (the owner): a team's Drive token is its own blob,
  not the account's.** `account_drive` is the Drive connection for an account's *personal* space; a team's is a
  different token, so `team_credentials` and these two columns stay. They become `NOT NULL` with no `''` default,
  and a `CHECK` that they are not empty, once the production query in section 6 shows no team has them empty.
- `sessions.email` and `account_identities.email` are not duplicates: each is the address that login or session
  was made with. Keep.
- `teams.owner_email` is a register fact ("who owned it, when it ended": CLAUDE.md), and `team_events.by_email` is
  an audit trail. **Both must keep an email, not a foreign key**, because the register outlives the account.

**F. Indexes.** Missing: `team_members (account_id)` (the join in B scans the table), `teams (owner_account_id)`,
`team_invites (email, created_at)` (`invite-email.ts` counts by it), and `sessions (expires_at)` (the cleanup scan). One
goes with B: `team_members_identity`. `teams_owner_email` and `teams_ccli_licence` are for the owner's console
queries (SPACES.md) and stay.

**G. Documentation that no longer matches the table.** CLAUDE.md says sign-in codes are "hashes, for ten
minutes". Since migration 0006 `login_codes` also keeps the **address and the code readable for up to three
days** (its comment says so and why). **Decided (the owner): keep the design and reword the rule.** CLAUDE.md now says so (and ACCOUNT.md and SECURITY.md
already did). The *table* is still tidied (C): see section 8.

**Fine as it is.** `STRICT` throughout; `WITHOUT ROWID` on the keyed tables; every timestamp is one UTC ISO-8601
string (`strftime('%Y-%m-%dT%H:%M:%fZ')` in SQL, `toISOString()` in code: the same format); the `account_identities`
(provider, sub) key; `account_drive`'s one row per account; `team_refs` (small, and deleted with its team, though it
only grows while a team lives). Ids stay as they are (hex from `randomblob`, uuids, the invite code's hash); new ids
are ULIDs from now on (D1_PHASE1_PLAN.md).

## 3. The proposed shape of what exists

`NOT NULL` unless it says otherwise; every table `STRICT`. Timestamps stay ISO strings, and each gets
`CHECK (x GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')` so a different format cannot get in.

```sql
accounts            (account_id PK, name NULL, created_at)
account_identities (provider CHECK IN ('google','email'), sub, account_id → accounts CASCADE, email,
                    created_at, last_seen_at,  PK (provider, sub),  INDEX (account_id), INDEX (email))
account_emails      (email PK CHECK (email = lower(email)), account_id → accounts CASCADE, created_at,
                    INDEX (account_id))
account_drive       (account_id PK → accounts CASCADE, blob, google_email, scope, created_at, updated_at)
sessions            (session_id PK, account_id → accounts CASCADE, email, token_hash, previous_hash NULL,
                    rotated_at NULL, created_at, last_used_at, expires_at, revoked_at NULL,
                    INDEX (account_id), INDEX (expires_at))
login_codes         (address_hash PK, code_hash, created_at, expires_at, attempts CHECK (>= 0),
                    window_start, sent CHECK (>= 1), link_hash UNIQUE, address CHECK (= lower),
                    code, next NULL)    -- the four columns 0006 added are required but `next`

teams               (space_id PK, name, owner_account_id → accounts RESTRICT, owner_email CHECK (= lower),
                    ccli_licence NULL, root_ref NULL, credential CHECK IN ('owner','service-account')
                    DEFAULT 'owner', created_at, updated_at, ended_at NULL,
                    INDEX (owner_account_id), INDEX (ccli_licence), INDEX (owner_email))
                    -- owner_provider, owner_sub: kept, NOT NULL, CHECK (<> '')  (the credential's owner login)
team_members        (space_id → teams CASCADE, account_id → accounts CASCADE,
                    role CHECK IN ('admin','writer','reader'), joined_at,   -- was `since`
                    PK (space_id, account_id), INDEX (account_id))
                    -- identity, email: dropped
team_invites        (space_id → teams CASCADE, id, email CHECK (= lower), role CHECK IN (...),
                    created_by_account → accounts SET NULL, created_at, expires_at, emailed_at NULL,
                    PK (space_id, id), INDEX (email, created_at))
team_refs           (space_id → teams CASCADE, ref, PK (space_id, ref))
team_credentials    (space_id PK → teams CASCADE, blob)         -- the team's own Drive token, not account_drive's
team_events         (id PK, space_id → teams CASCADE, created_at,   -- was `at`
                    kind CHECK IN ('created','joined_as_other','ended','licence'), by_email, detail NULL,
                    INDEX (space_id, id))                       -- by_email stays text: it outlives accounts
team_member_emails  dropped (E)
```

Two notes. A `teams` row is **never deleted** (the register outlives the team), so the `CASCADE`s from `teams`
only matter if a team is ever hard-deleted; they are there so that is possible and so that no orphan can exist.
`teams.owner_account_id` is `RESTRICT`: an account that owns a team cannot be deleted until the team is ended or
handed on, which is what ACCOUNT.md already says.

## 4. How to get there

**One migration, `0011_schema_cleanup.sql`, before anything else changes** (D1_PHASE1_PLAN.md, step 0), using the
rebuild in section 1: create every new table as `x_v2`, copy parents before children, drop the old tables, rename
the `_v2` tables. The copy does the clean-up: `team_members` takes its `account_id` from the existing column, falling
back to `account_identities` through `identity`; a row that still has no account is a **failure to look at, not
to hide**, which is what section 6's checks are for. `INSERT … SELECT` converts the sentinels (`''` to `NULL`).

The Worker code changes in the **same pull request**, because the schema and the queries must agree: `team-state.ts`
loses its `OR m.identity = ?` branches and its hand-written cascades; the join becomes `m.account_id =
acct.id`; `created_by` becomes an account. The migration is **not additive**, so unlike 0006, the Worker before it and
the Worker after it cannot both run: deploy the migration and the Worker together, in one go, with the site
briefly in read-only mode or accepted downtime (a few seconds, two teams). Take `just db-backup` first.

## 5. Tests

- A node test applies migrations 0001 to 0011 to a database with **realistic rows** (a team with an owner, members
  with and without `account_id`, an invite, refs, a credential, events) and checks the result row by row, that
  `foreign_key_check` is empty, that deleting an account cascades as intended, that a bad role or provider is
  refused, and that `table_list` says every table is `strict`.
- The existing `team-state.node.test.ts` and `team-api.node.test.ts` pass unchanged where behaviour is unchanged.
- A test that fails if a future migration adds a table that is not `STRICT`, or a column named `*_id` with no
  foreign key (a small script over `sqlite_schema`, run in the node tests).

## 6. Before it is run on production

Run `scripts/schema-preflight.sql` against the real database (read-only; it is for the schema **before** `0011`):

```
npx wrangler d1 execute chordless-teams --remote --file scripts/schema-preflight.sql
```

It answers with a row for each thing `0011` would stop on (`wanted` is `0`): a member whose account cannot be found, two logins of
one account in one team, an empty owner login, a live team with no owner account, a role or a credential that is
not one of the closed sets, an address not in lower case, and every row that would break a new foreign key (a login, an
address, a Drive connection, a member or a team's own rows that point at what is gone). Rows marked `info` are what the
migration drops or changes, and how much there is. A non-zero is not damage (the migration refuses the row and is undone
whole): it is what to put right first, or to decide about. D1 allows only five terms in a compound `SELECT`, so the
file is several statements, each answered on its own. Tried on a local D1: clean on the old schema, and a planted
row of each kind is caught.

Then a rehearsal of the migration on a copy of the exported data (`just db-backup` makes the dump).

## 7. Decisions (the owner, 2026-11-20)

1. **`team_member_emails` is redundant**: dropped (E).
2. **A team's Drive token is its own blob**, different from `account_drive` (an account's personal space):
   `team_credentials`, `owner_provider` and `owner_sub` stay (E).
3. **`login_codes` keeps the readable address and code for three days**; CLAUDE.md is reworded (G, done).
4. **A few seconds of downtime is acceptable** for the migration, with two teams, and not on a Sunday (section 4).

What is left to decide is only what the production queries of section 6 turn up.

## 8. What was built (`0011_schema_cleanup.sql`), and where it differs from section 3

The rules it followed are now in [SCHEMA_RULES.md](SCHEMA_RULES.md). Differences from the proposal, with why:

- **`team_member_emails` is gone, but not wholly redundant.** Its `'signin'` rows are derivable from `account_emails`, as
  decided. Its `'invite'` rows were not: when someone is invited as `alice@x` and signs in as `alice@y`, the team keeps
  `alice@x` as theirs (so the people who know them by it still do, and `setRoleByEmail('alice@x')` still finds
  them). That is now **`team_members.invited_as`**, one address, set when the invite is used. (One member who had
  several 'invite' rows keeps the first, by address.) A member's shown address is their account's first.
- **No timestamp `CHECK`.** Proposed in section 3; dropped: every write is `toISOString()`, and it would have meant
  changing most fixtures for little protection.
- **No `CHECK` on `account_identities.provider` or `team_events.kind`**: both are open sets (a Microsoft sign-in is
  planned), and SQLite cannot change a `CHECK` without a rebuild. Closed sets are checked: roles, `credential`,
  lower-case addresses, non-empty owner login.
- **`teams.owner_account_id` is nullable, `ON DELETE SET NULL`, with `CHECK (ended_at IS NOT NULL OR owner_account_id
  IS NOT NULL)`**, not `NOT NULL RESTRICT` as proposed: the register of teams outlives the team, so an *ended*
  team must be able to lose its owner's account, while a live one cannot (the delete is refused).
- **`team_invites.created_by` stays an address**, not an account: it is shown as one, and an invite is short-lived.
- **`team_credentials` stays, with `owner_provider` and `owner_sub`** (decision 2), now `NOT NULL` and not empty.
- **Sessions of an account that is gone are dropped** in the copy (they are disposable); every other row that would
  break a constraint stops the migration instead.
- **Tested** against rows as production has them and against the cases it must refuse
  (`tests/schema-cleanup.node.test.ts`), and a failing migration was shown to be undone whole on a local D1.
- **Deploy order** (`.github/workflows/deploy.yml`): the Worker is deployed, then the migration applied, with a
  Time Travel bookmark noted between: for a few seconds the new Worker runs on the old schema. Merging the pull
  request is what runs it.
- **`login_codes` is rebuilt too** (it was first left alone: that was a mistake). Every request for a code sets `link_hash`,
  `address` and `code`, so they are `NOT NULL`, `link_hash` is `UNIQUE` (a link names one row; the old plain index is
  replaced), the address is `CHECK`ed lower-case as the code makes it, and the counters cannot go negative. Only
  `next` stays optional. A row from before 0006 (no link, no address) is dropped in the copy: it ran out days ago
  (a code lasts three days) and could not be used.

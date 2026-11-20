# How the D1 schema is written

**Read this before adding or changing a table, a column or an index in `migrations/`.** It is the rules the schema
was brought to by `0011_schema_cleanup.sql` (the reasons and the audit are in [SCHEMA_AUDIT.md](SCHEMA_AUDIT.md)), and what
a reviewer will check. How a migration is rolled out is in [MIGRATIONS.md](MIGRATIONS.md); the shape the schema is
heading for is drawn in [D1_SCHEMA.md](D1_SCHEMA.md). D1 is SQLite on Cloudflare, so everything here is SQLite.

## A table

1. **`STRICT`, always.** Every table is `STRICT` (the types are checked). `tests/schema-cleanup.node.test.ts` fails
   if one is not. Types are `TEXT`, `INTEGER`, `REAL`, `BLOB` (and `ANY`, which you will not need).
2. **Foreign keys, always, and declared.** A column that names a row of another table is
   `REFERENCES parent (column) ON DELETE …`. D1 enforces them (they are on by default; a PRAGMA cannot turn them
   off for a request). Choose the action on purpose:
   - `CASCADE` for what only exists for the parent (a team's members, refs, invites; an account's logins and
     sessions);
   - `SET NULL` where the row must outlive the parent (a team's owner account: the register of teams outlives
     the account), with a `CHECK` that says when the column may be NULL;
   - `RESTRICT` (the default, `NO ACTION`) where the parent must not go while the row exists.
   The test above fails for a column named `account_id`, `space_id` or `owner_account_id` with no foreign key.
   A value that is a *label* and must outlive what it names (`team_events.by_email`, `team_invites.created_by`: an
   address, shown as one) is text, not a key, and the column's name says so (`*_email`).
3. **`NOT NULL` unless NULL means something.** And **never `''` (or `0`) for "not set"**: use NULL, so that a
   value and its absence cannot be confused, and a `CHECK (x <> '')` where a value must not be empty.
4. **A key you can name.** Every table has a primary key. A table that is a relation is keyed by the pair
   (`PRIMARY KEY (space_id, account_id)`), not by a surrogate id, and the key **starts with the owner**
   (`space_id`, `account_id`) so that a person's or a space's rows sit together.
5. **`WITHOUT ROWID` for small rows keyed by something other than an integer** (a composite key, a text id): the
   table is then stored in key order and needs no second index. **Not** for rows with a big body (a setlist's JSON, a
   token blob is borderline): SQLite's own advice is that rows over about a twentieth of a page do better with a rowid.
   `WITHOUT ROWID` has nothing to do with foreign keys: they work either way.
6. **`CHECK` a closed set that will not change, not an open one.** Roles (`admin | writer | reader`), the credential
   (`owner | service-account`), lower-case addresses (`email = lower(email)`): yes. Login providers (a new sign-in
   method will add one), the kinds of a log, the format of a timestamp: **no**, because SQLite cannot change a `CHECK`
   without rebuilding the table. If the set may grow, validate it in the Worker.
7. **An index for every foreign key and every column a query filters or joins by** (SQLite does not index a
   foreign key for you; deleting a parent scans the child without one). A composite primary key is the index for its
   first column.

## Names and values

- Tables are plural nouns, `snake_case`; a table of a space's data starts `space_`, a team's `team_`, an account's
  `account_`. **Do not use the word "central"** in a table, route or file: where data is kept is not a thing
  that needs a name.
- A column that names another table's row is `<thing>_id`. A time is `<what>_at` (`created_at`, `joined_at`, not `since`, `at`);
  an optional one, `ended_at`, is NULL until it happens. **A time is text: UTC ISO 8601 with a Z** (`toISOString()`;
  in SQL `strftime('%Y-%m-%dT%H:%M:%fZ','now')`), so it sorts as text. Not CHECKed (see 6), but a column of any
  other format is a bug.
- An address is lower-cased by the code **and** by a `CHECK` where it is a key or a label.
- **New ids are ULIDs** (26 characters, time-ordered, so inserts stay at the end of an index and a list sorts by when it was
  made), from `src/js/ulid.ts` on the device and in the Worker. **Existing uuids and the hex ids from `randomblob`
  stay as they are**: an id is an opaque string, the two kinds sit side by side, and nothing may assume the
  shape of one (`setlistCode()` in `share-crypto.ts` does today, and is to be fixed: D1_PHASE1_PLAN.md).
- One table per kind of record, with real columns for what is queried, **not a generic table of JSON documents**.
  A column of JSON (`body`) holds only what is never filtered or joined by.
- No tombstones (`deleted_at`) and no change feed where a whole read is cheap: a deleted row is a missing row
  (D1_PHASE1_PLAN.md, "Space data and its sync"). A `version INTEGER` is for refusing a write that was based on an
  out-of-date row, and `modified_at` for people and reports.

## A migration

- **Additive by default**: a new table, a column with a default, an index. The Worker that was running before a
  deploy keeps running on the old schema for a moment, and again after a rollback (MIGRATIONS.md).
- **Roll forward only**: a change is a new file, never an edit of one that has been applied.
- **When the shape must change in a way SQLite cannot do in place** (a foreign key, `NOT NULL`, a `CHECK` or a dropped
  column on an existing table), rebuild, as `0011` did: create every new table under a `_v2` name with its foreign
  keys pointing at the other `_v2` tables, copy parents before children, drop the old tables (nothing references them
  while they had no foreign keys; **if they have, a drop cascades**: copy first, and drop children before parents),
  rename each `_v2` (SQLite rewrites the references), then create the indexes. Do not rely on turning foreign keys
  off: D1's two documentation pages disagree about it.
- **A migration that can lose or guess at data must fail instead.** D1 runs a migration as one transaction and undoes
  it if a statement fails (tried on a local D1), so a `NOT NULL` or `CHECK` that a real row breaks is a safe stop. Write
  the check as the schema, not as a comment, and put the production query that finds the bad row in the audit.
- **PRAGMAs apply to one transaction only** and D1 supports a subset (`table_list`, `table_info`, `foreign_key_list`,
  `foreign_key_check`, `defer_foreign_keys`, `quick_check`, `optimize`, …). There is no persistent configuration: the
  schema carries every rule.
- **Test it on rows as they are in production**: apply the migrations before yours, insert rows the way the old code
  wrote them (the awkward ones included: a member with no account, an empty string, an orphan), run yours, and check the result row by row
  (`tests/schema-cleanup.node.test.ts` is the pattern). Tests run the real migration files against SQLite
  (`tests/d1-db.ts`, `node:sqlite`, with foreign keys on, as D1).
- **Back up first** (`just db-backup`), and rehearse on a copy of the data when the migration is not additive.

## Checking a database

```sql
PRAGMA table_list;               -- strict = 1 for every table of ours
PRAGMA foreign_key_list(team_members);
PRAGMA foreign_key_check;        -- empty
PRAGMA quick_check;              -- ok
```

(`wrangler d1 execute chordless-teams --remote --command "…"`, or `--local --persist-to <dir>` for a rehearsal.)

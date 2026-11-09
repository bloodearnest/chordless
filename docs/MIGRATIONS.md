# Migrations

What changes when the shape of stored data does: the database on a device (IndexedDB), and what is in Drive.
They are different problems. The database of a device changes only when that device's app does; Drive is
shared by devices on different builds at the same time.

## The database on a device

One IndexedDB database per space (named by the space's id), opened by `ChordlessDB.init()` in `src/js/db.ts`.
`DB_VERSION` is its schema version, and what the browser gives us is small:

- `indexedDB.open(name, version)` runs `onupgradeneeded` if the stored version is lower, in one
  **versionchange transaction**. It is atomic: if the handler throws or the transaction aborts, nothing
  changes and the version stays what it was. It cannot `await` anything but IndexedDB requests (the
  transaction commits when its requests run out), so the steps are written with request callbacks.
- Only one connection can upgrade at a time: the others get `versionchange`, and the one waiting gets
  `onblocked` until they close.
- **There is no downgrade**: opening at a lower version fails with `VersionError`.
- There is no schema declaration, no history of what ran, no dry run. Devtools (Application, IndexedDB) can
  look at a database and delete it.

How it is done here: no library (`idb` and Dexie were looked at, and neither does what is hard here: skew,
rollback, telemetry). `onupgradeneeded` makes every store and index that is missing (`if (!contains)`, so a new
database and an old one end up alike), then `upgradeRecords(transaction, oldVersion)` rewrites what a version
changed, with `oldVersion < N` guards, so steps compose. Steps of versions before the floor (below) are not kept: `git log -S`
finds them.

### The floor

Steps for old versions are dropped, and `OLDEST_UPGRADABLE` (in `db.ts`, 14 now) says which are left. A database of an
older version is **not upgraded**: the upgrade is aborted, which leaves it exactly as it was, and `init()` decides:

- **Signed in with Google, with Drive** (`getSignInState()` is `signed-in`): the database is deleted and made again, and
  the sync brings the songs and setlists back from Drive. A toast says so. What is lost is what Drive never had: what
  was not synced yet, and state of this device alone (`setlist_local`). The space's link to its Drive folder is not in this
  database (it is in the spaces database), so the sync knows where to look.
- **Otherwise** (signed out, no Drive, or a sign-in Google no longer honours): **it is not cleared.** It is left as it is,
  `init()` rejects with `DatabaseTooOldError`, and a toast says the data is old, untouched, and that signing in with
  Google brings it back from Drive. Nothing is deleted for want of a copy.

Raising the floor is a decision about who still has such a device: look at `chordless.db.version` (below) first, and
when nobody does, drop the steps and the tests of the versions below it. It also moves `OLDEST` in
`tests/db-upgrade.test.ts` (it is `OLDEST_UPGRADABLE`) and removes the snapshots under it.

### Rules for a change

1. **Bump `DB_VERSION`, and add a snapshot of the version you left** to `tests/db-upgrade.test.ts`
   (`SCHEMAS`, in `tests/old-database.ts`): the test fails without it, and checks that the upgrade gives the
   stores and indexes a new database has. Add a test of what the step does to the records, from a
   database built with `oldDatabase()`.
2. **Derived data is cleared, not converted**, where it can be made again (v14 did this for the melody).
3. **Destructive changes take two releases.** Copy in one, drop in the next: a store that is dropped in the
   release that copies it cannot be had back. (v15 dropped `melodies` at once, as scores are derived and in Drive.)
4. **Roll forward, never back.** A device that has been upgraded fails to open its database under an older build
   (`VersionError`), and a rolled-back service worker *is* an older build: devices that already updated install it.
   A bad release is fixed by a new one. (`wrangler rollback` in the deploy's smoke test is safe because nobody has
   updated to a build that failed its smoke test.)
5. Each step is idempotent where it can be, and does not depend on the app's other code: the records are read
   as they were, not through today's types.

### How a rollout goes

A new service worker installs and waits (`service-worker-core.ts`); the page is told, and the user reloads when
they choose (`app-update.ts`). So a device's code and its database change together, at a moment of the user's,
and builds a few weeks apart can be in the field at once without touching each other's databases. What can
go wrong:

- **Two windows.** The window on the older build lets go of the database when the newer one upgrades it
  (`onversionchange`), and can no longer use it: it says "Chordless was updated in another window. Reload this one to
  carry on." The newer window, if the older held it open, says "Close the other Chordless windows to finish
  updating." (`onblocked`).
- **Data older than the floor**: see above.
- **Data newer than the code** (a rolled-back build, or an old tab on a new database): `init()` rejects with
  `DatabaseNewerError`, and says "This device has newer Chordless data than this version can read", with a
  button that looks for a newer app.

## Drive

Files are written by every build that has been in use, and read by every other. So what is read is more
forgiving than what is written: `withNumericTempos` and `adoptLegacyLeader` on a pulled setlist, a score
read from either of its names (`type: 'melody'` or `'score'`), `legacyFile` to rewrite an old file once
(`docs/SYNC_ARCHITECTURE.md`, "Scores"). A reader of a Drive folder cannot write, so old files are read for as
long as they might be there. Older clients skip what they do not know: a file in `songs/` whose `type` is not
`chordpro` is ignored.

## Tests

- `tests/old-database.ts` makes a database as an older version left it (a written-out schema, and records), and
  `schemaOf` describes one that was opened.
- `tests/db-upgrade.test.ts`: from every version below the current one, the upgrade gives a new database's stores
  and indexes, and there is a snapshot for each.
- A step's own test builds the old records and checks the new (`db.test.ts` for the older steps, `db-scores.test.ts`).
- `tests/db-open.test.ts`: what opening reports and tells (below), and a database below the floor: untouched with no sign-in
  (and with a sign-in that has no Drive), cleared and made again with one.

## What is reported

`chordless.db.open` is one span, only when an open is **upgraded**, **blocked** or **failed** (the many plain opens
are not worth the spans): `chordless.db.outcome` (`upgraded`, `blocked`, `failed`, `cleared` and `too_old`: below the floor,
with a sign-in and without), `.old_version` (when there was one), `.sign_in` (`too_old`: where the sign-in stood), `.new_version`, `.open_ms`, and for a failure `.error` (the DOMException's name: `VersionError`,
`AbortError`, ...) and `.error_message`. Every browser span carries `chordless.db.version`, the version of the database
last opened, so how far the devices have been upgraded is a query (COUNT_DISTINCT `device.id` by
`chordless.db.version`), and a smeared rollout can be seen to finish. See `docs/OBSERVABILITY.md`.

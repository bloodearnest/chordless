# Setlists, people and preferences in D1

**Status: design, not built (2026-11-16).** Agreed in outline with the owner; nothing here is in the code yet.
Where a decision is still open it is under "Open questions".

## The idea

Chordless used to need a Google account because everything it syncs was copyrighted or derived from
copyrighted work: ChordPro files, and then lead sheets (MusicXML). It also wanted to be local and offline
first, so Drive held the data and the device held a copy.

Since then Teams have arrived, with a name, a CCLI licence number, members and roles, and those live in D1
(`docs/SPACES.md`) because a central, online API is far easier to run than files in Drive, and none of it is
needed offline. A Team's songs already reach its members through the Worker, so a member needs no Google
account at all.

Only the **songs** are copyrighted: the ChordPro text, the MusicXML, and the pad audio. A setlist is a list of
which songs, in what order, in what key, with what annotations. People, teams and preferences are not
copyright material either. So:

| Kept in D1 (central, small, easy to sync) | Kept on the device, and in Drive (or another store) only if the user turns that on |
|---|---|
| Setlists: date, time, type, name, leader, entries (song reference, key, tempo, notes, annotations) | Songs: ChordPro, lead sheets (MusicXML) |
| People (who can lead a setlist, their addresses) | Pad audio and pad sets |
| Teams, members, roles, invites, the CCLI licence (already so) | Share-link ciphertext (see "Share links") |
| Later: a person's preferences | |

**A personal space works like a Team space.** Its setlists and people are in D1; its songs are on the device.
There is no cross-device sync *of songs* unless the owner turns on Drive (or, one day, OneDrive) for the
space. That is the existing opt-in, and a Gmail account is only needed for that.

## Decisions (the owner, 2026-11-16)

- Free text in a setlist (an entry's `notes`, an annotation) is not a worry: it is very unlikely to be more
  than a short phrase, and quoting a fragment is allowed. D1 may hold it.
- Holding this data centrally is fine for the privacy policy: it already says what the server keeps about a
  user (`src/privacy.html`), and accounts were added to it with `0003_accounts.sql`.
- **Preferences are a new feature, not part of this move: they come last.**
- The rule is now worded as CLAUDE.md has it (2026-11-16): Chordless never stores copyrighted content
  itself; that is stored locally, and optionally synced with the user's own cloud storage (e.g. Google Drive).
  The privacy page and `docs/SPACES.md` follow when the first part is built, so that no text says something
  the code does not do.

## What a setlist is when its songs are not on the device

A second device with a setlist and no songs is the case the email import already handles: entries whose songs
are missing are shown as such, and the person is guided to SongSelect and the bookmarklet to get the song
(`docs/EMAIL_IMPORT.md`). Central setlists make it the normal case on a new device, so an entry must say
enough to be recognised without its song:

- `SetlistEntry` has `songId`, `songUuid`, `key`, `tempo`, `notes` and `annotations`, but no title. It gains
  **`title`** and the song's **`ccli`** number (from the song, where it has one), copied when the entry is made
  and refreshed when the song is opened. A missing song then shows its title, key and CCLI number, and
  "Get this song".
- Nothing else of the song is copied into the setlist: no text, no chords, no section names.

## A song index in D1 (decided 2026-11-20)

Besides setlists and people, D1 keeps an **index of a space's songs**, a third collection beside them
(`song-index`, in `space_docs`). One row per song: `uuid`, `space_id`, title, CCLI song number, default key,
the CCLI licence the chart came in under, a content hash, and the Drive file id (already allowed: "the ids of
the Drive files in a team's tree"). **No lyrics, no chords, no first lines**: the ChordPro, the MusicXML and
the pad audio stay on the device and in the space's Drive, so "no song content in D1" stays true. Titles and
CCLI numbers are the same kind of data as the `title` and `ccli` a setlist entry gains below.

What it gives:
- A new device knows the whole library before it has a chart; "Get this song" has a real target.
- A cross-space copy (below) finds which space has the song, and duplicates are caught by CCLI number.
- The CCLI usage report is a query (phase 2).
- Sync stops listing Drive folders or reading its change feed to learn what changed: the index says so.
- A setlist entry's `title` and `ccli` are read from the index, not only copied.

Risk: the index drifts from the files (an older build, or an edit made in Drive). The content hash lets the
engine notice and reconcile it, as it does for setlists. The privacy page must say it keeps titles and CCLI
numbers before this is built.

## Setlists use songs from any space (decided 2026-11-20)

The aim is that songs and setlists from **all** spaces are shown at once, with no "current space" to switch
(`docs/SPACES.md`, "Presenting spaces"). A setlist may use a song that another space holds, and doing so
**copies the song into the setlist's space**: a setlist only ever refers to songs of its own space. The copy
follows the licence rule in `docs/CCLI.md`: the same licence number is the same church, so it copies
silently; a different or unknown licence asks first (a confirmation, never a block); a chart with no
SongSelect source moves freely.

## Where it lives: the storage seam already exists

The sync engine talks to a space through `StorageBackend` (`docs/STORAGE_API.md`), whose files are in
**collections**: `songs`, `setlists`, `people`, `shares` (`src/js/storage/types.ts`). A Team member's backend
is the Worker (`TeamStorage` over `worker/src/team-api.ts`, which serves any collection by name), and the
owner's is Drive. So this is a change of *where two collections are kept*, not a new sync engine:

1. A **D1-backed implementation of the file operations for `setlists` and `people`**, in the Worker:
   `list`, `read`, `create`, `update`, `delete`, with the revision the engine already uses to tell a conflict
   (`fileRev`, `syncedContentHash`).
2. **Routing by collection** (`storageFor(space)` in `src/js/storage/space-storage.ts` returns one backend
   today): a composite that sends `setlists` and `people` to the D1 backend and `songs`, `shares` and pads to
   whatever the space uses (the Worker for a Team, Drive or nothing for a personal space).
3. The local copy stays the primary. D1 is the sync target, as Drive is now; offline edits wait and go when
   the device is online. This is simpler than Drive because the server is one authority with a number on
   each row, where Drive means listing, change feeds, quotas and eventual consistency.

### Tables (sketch)

```sql
-- the documents of the collections kept in D1
CREATE TABLE space_docs (
  space_id TEXT NOT NULL,        -- a Team space's id, or a personal space's, registered to an account
  collection TEXT NOT NULL,      -- 'setlists' or 'people'
  doc_id TEXT NOT NULL,
  body TEXT NOT NULL,            -- the record, as JSON
  version INTEGER NOT NULL,      -- +1 on every write; a write names the version it was made from
  modified_at TEXT NOT NULL,
  deleted_at TEXT,               -- a tombstone, so a device that was offline hears of the delete
  PRIMARY KEY (space_id, collection, doc_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX space_docs_changes ON space_docs (space_id, collection, modified_at);
```

A write is `UPDATE … SET version = version + 1 … WHERE … AND version = ?`: no row changed means a conflict,
which the engine already resolves for Drive. The live channel (`docs/LIVE_SYNC.md`) says "changed" on a write,
as it does for Drive now, and still never carries a setlist.

**Who may write:** a Team's roles apply as they do (`docs/SPACES.md`): a worship leader and above change
setlists and people, a team member reads and names themselves (`docs/IDENTITIES.md`). A personal space belongs
to one account.

## What it needs that is not there yet

- **An account for a personal space.** Personal setlist sync belongs to a Chordless account (`accounts`,
  0003). Today that means signing in with Google; "no Google at all" comes with the Chordless session and a
  second sign-in method (Microsoft, emailed link), which is a separate piece of work. Without an account, a
  personal space stays local-only, as now.
- **A personal space registered with the server** when its owner turns sync on: a space id, its owner
  account.
- **Moving existing Drive users' setlists and people into D1** (below).
- **Account deletion and export.** The Worker would hold people's setlists, so deleting an account removes
  its personal spaces' rows, and the zip export of a space (`space-export.ts`) includes them.

## Moving the existing Drive data

Devices on different builds share one Drive at once (`docs/MIGRATIONS.md`), so the move cannot be an
instant switch:

1. A new build, on its first sync of a space, imports the space's setlist and people files from Drive into
   D1 (only where D1 has none for that space), and writes a marker file in the Drive folder.
2. From then on it keeps those two collections in D1 and stops writing them to Drive.
3. An older build, which does not know the marker, keeps writing setlists to Drive. For a grace period the
   new build also looks at the Drive files and imports any changed after the marker, so a late device's edits
   are not lost. After it, Drive's copies are an archive and are left alone.
4. Devices update within days (the service worker); the length of the grace period is an open question.

## Share links

A share is an encrypted file in the space's Drive `shares/` folder, which the Worker caches without being
able to read it (`docs/SHARING.md`). A personal space with no Drive has nowhere to put it, so it could not
make a share link. Options: keep sharing a Drive feature; or let the Worker keep the ciphertext for the life
of the share (an extension of the one exception to "never stores content" already made for the cache). Not
decided; the first phase does not touch it.

## An upside: what the church sang

With setlists central and each entry carrying its CCLI number, the usage a church must report to CCLI is a
query over its setlists for a period (`docs/CCLI.md`). That is a feature on top of the move, listed as phase 2.

## Phases

0. **Show every space at once** (UI only, before any of this): the Setlists and Library pages list all spaces
   behind one "all spaces" query, with the tabs as a filter; the current space is removed last. Sync of
   several spaces is not built Drive-shaped first: it comes with phase 1, as one account-wide "changes since".
1. **Teams.** `setlists`, `people` and the song index of a Team space in D1; collection routing in the sync
   engine; entries carry `title` and `ccli`; songs and pads stay as they are. Rewrite the rule in CLAUDE.md and the privacy page.
2. **CCLI usage report** from a Team's setlist history.
3. **Personal spaces.** Registered to an account; the move out of Drive; a decision on share links.
4. **Preferences per account** (a new feature: last). Small, local copy first, last write wins per key; which
   preferences are the person's and which belong to a device (audio output, screen size) is decided then.

## Open questions

- The live channel for several spaces: one socket per team, or one per account.
- Conflicts: whole-setlist last write wins with the engine's conflict handling as now, or a merge per entry?
  Start as Drive does today.
- The grace period for Drive's late writes, and whether to import for it or just warn.
- D1's size limit as the number of setlists grows: a setlist is a few KB; check the limit on the plan before
  personal spaces.
- Whether `people` stays per space (it does today) or becomes the account's own address book.
- How long a deleted setlist's tombstone is kept.

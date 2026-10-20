# DATA MODEL

The Chordless data model is somewhat complex, primarily for one reason: Chordless
cannot store the song data, as that is copyrighted. The users must store it, on
their devices or on their own google drive.

There are 3 core models stored per space (called "organisation" before 2026-10-20; some stored names still are). Each space has an IndexedDB
database named exactly after its `spaceId` containing four object stores:

1. `songs` – flattened song variants (metadata only)
2. `chordpro` – raw chordpro text + hashes
3. `setlists` – setlist documents
4. `setlist_local` – local-only per-user state (not synced)

Drive sync stores JSON/ChordPro files inside the space’s Google Drive folder
and tracks Drive metadata (`driveFileId`, `driveModifiedTime`, `lastSyncedAt`, `_lastSyncHash`, etc.)
on each record.

## Song

Songs are flattened variants. Each record references its chordpro content by ID.
Fields stored in the `songs` store (per space):

- `uuid`: unique variant identifier
- `id`: deterministic key (CCLI-derived or normalized title)
- `variantOf`: uuid of the source variant (or null)
- `isDefault`: is this variant the default for its deterministic `id`
- `variantLabel`: friendly label (“Original”, “Simplified”, etc.)
- `chordproFileId`: FK into the `chordpro` store
- Metadata extracted from chordpro: `ccliNumber`, `title`, `titleNormalized`, `author`, `copyright`, `key`, `tempo`, `time`
- Import metadata: `importDate`, `importUser`, `importSource`, `sourceUrl`
- `modifiedDate`: when this variant was last edited
- Sync metadata: `driveFileId`, `driveModifiedTime`, `lastSyncedAt`, `driveProperties`, `contentHash`

### ChordPro Store

The `chordpro` object store mirrors chord text:

- `id`: referenced by `chordproFileId`
- `content`: raw chordpro text
- `contentHash`: hash used for deduping + sync comparisons
- `lastModified`: timestamp of last edit (used when comparing with Drive)

### Song Versioning

Songs are immutable - any edit creates a new variant with a new UUID. This provides:

- Each variant links back to the song it was copied from via `variant_of`
- Multiple variants of the same song (same deterministic id) can exist within a space
- One variant is marked as the default (`is_default: true`) which is shown first when browsing
- "Official fixes" are just variants that are marked as the new default
- When two users edit different versions offline and sync, both variants are preserved; last updated wins for which is default
- A future tool will allow merging/removing variants

The goal is that every song the space has ever seen is available in
a single maintained per-space index of songs (stored in IndexedDB). If a song is imported that is already
present, the user is given the option to update to the new version, ideally
showing the differences.

## Setlist

A list of songs, with metadata and sync state:

- id: uuid
- date: date of the event (YYYY-MM-DD)
- time: time of the event (HH:MM)
- type: type of event (Church Service, Prayer Meeting, Event, Other)
- owner: user who leads/owns this setlist
- name (optional)
- createdDate
- modifiedDate

Each song in the setlist has metadata specific to this setlist:

- order: position in the setlist
- songId: the deterministic id of the song
- songUuid: the specific variant uuid chosen for this setlist
- key: transposition/key override for this setlist (optional)
- tempo: tempo override for this setlist (optional)
- notes: performance notes for this song in this setlist

Setlists also store sync metadata: `driveFileId`, `driveModifiedTime`, `lastSyncedAt`,
`_lastSyncHash`. These fields are updated whenever a setlist is uploaded/downloaded from Drive.

Notes:

- When adding a song to a setlist, the user selects which variant to use
- A setlist cannot reference multiple variants of the same song
- Only song references (id + uuid) are stored in the setlist, not the full song content
- The setlist is stored as a single document locally in IndexedDB and synced remotely to Google Drive

### Local State (setlist_local)

There is companion local state that is only stored for the current user locally (not synced):

- setlistId: reference to the setlist
- padsEnabled: boolean
- padSound: selected pad sound
- clickEnabled: boolean (metronome)
- sectionVisibility: per-song section visibility states (which sections are shown/hidden)
- lastUsedDate: when this setlist was last viewed

This state is stored in a separate object store `setlist_local` (not synced to Drive) as it represents personal preferences for this device/user, not shared setlist data.

This state is populated from some per-user defaults when they first load the setlist.

## Space

A space owns a set of songs and setlists and is the target they sync to. Its model (personal and
team spaces, storage, isolation, rename, the default "Personal" space, copy/move) is in
[SPACES.md](SPACES.md); the per-space IndexedDB is the one described at the top of this file.

# DATA MODEL

The Chordial data model is somewhat complex, primarily for one reason: Chordial
cannot store the song data, as that is copyrighted. The users must store it, on
their devices or on their own google drive.

There are 3 core models stored per organisation. Each organisation has an IndexedDB
database named exactly after its `organisationId` containing four object stores:

1. `songs` – flattened song variants (metadata only)
2. `chordpro` – raw chordpro text + hashes
3. `setlists` – setlist documents
4. `setlist_local` – local-only per-user state (not synced)

Drive sync stores JSON/ChordPro files inside the organisation’s Google Drive folder
and tracks Drive metadata (`driveFileId`, `driveModifiedTime`, `lastSyncedAt`, `_lastSyncHash`, etc.)
on each record.

## Song

Songs are flattened variants. Each record references its chordpro content by ID.
Fields stored in the `songs` store (per organisation):

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
- Multiple variants of the same song (same deterministic id) can exist within an organisation
- One variant is marked as the default (`is_default: true`) which is shown first when browsing
- "Official fixes" are just variants that are marked as the new default
- When two users edit different versions offline and sync, both variants are preserved; last updated wins for which is default
- A future tool will allow merging/removing variants

The goal is that every song the organisation has ever seen is available in
a single maintained per-organisation index of songs (stored in IndexedDB). If a song is imported that is already
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

## Organisation

This is an entity to which a set of songs and setlists belongs, and is used as
a target from where to sync data to remotely.

Properties:

- id: UUID (stable identifier, used as database name)
- name: organisation name (can be renamed without data migration)
- createdDate
- modifiedDate

### Storage Architecture

Organisations use a hybrid storage approach for optimal performance:

**Metadata Storage (SetalightDB-organisations):**

- Global IndexedDB database storing metadata for all organisations
- Contains: id, name, timestamps
- Used for listing available organisations and managing renames

**Data Storage (per-organisation databases):**

- Each organisation has its own IndexedDB database named exactly by its ID (e.g., `a1b2c3d4-...`)
- Contains: songs, chordpro content, setlists, and local state
- Database name never changes, even when organisation is renamed

**localStorage Caching:**

- Current organisation ID: `setalight-current-organisation-id`
- Current organisation name: `setalight-current-organisation-name`
- Allows synchronous access to org name for UI rendering without async DB calls

### Default "Personal" Organisation

On first app load, a default organisation named "Personal" is automatically created:

- Created with a random UUID as its database name
- Set as the current organisation in localStorage
- Provides immediate storage for songs and setlists without setup

**First-Time Google Auth:**

- When a user authenticates with Google for the first time
- If the current organisation is "Personal", it is automatically renamed to the user's name
- This provides a personalized experience without requiring manual setup
- The rename updates only the metadata; the database ID remains stable

### Organisation Isolation

Organisations are completely isolated:

- Songs and setlists belong exclusively to one organisation
- When a user switches organisations, the entire app reloads with the new organisation's IndexedDB
- Other organisations' data is unavailable when viewing a different org
- If two users in different orgs import the same CCLI song, they are treated as separate instances
- Setlists cannot be shared across organisations
- Each organisation has its own song index stored per-organisation in IndexedDB

This allows you to ensure copyright compliance per-org, as each org is
self-contained, but a user can be part of multiple orgs as needed.

### Renaming Organisations

Renaming an organisation is a lightweight operation:

- Updates only the `name` field in the metadata database
- Updates the cached name in localStorage if it's the current org
- Database name (org ID) remains unchanged, so no data migration is required
- All song, setlist, and state data remains accessible immediately

### Future: Export/Import

In the future, an export/import feature will allow moving songs/setlists between organisations,
but this will be done at the application level, not at the database level.

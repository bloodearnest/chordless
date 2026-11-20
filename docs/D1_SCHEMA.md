# The D1 schema: the proposed final shape

![The D1 schema](D1_SCHEMA.svg)

Grey tables exist today (`migrations/0001` to `0010`); the colours are the phase that adds each one (the CCLI usage report, phase 2, needs no table of its own)
([CENTRAL_STORAGE.md](CENTRAL_STORAGE.md), [D1_PHASE1_PLAN.md](D1_PHASE1_PLAN.md)). Foreign keys inside a
row (`team_members.account_id` and the like) point at `accounts` and are not drawn.

Choices worth reviewing:

- **One table per kind of record**, each with a `space_id`: `space_songs` (the index, no chords or lyrics),
  `space_setlists`, `space_setlist_songs` (a setlist's entries as rows), `space_people` and `space_pad_sets`.
  Real columns mean D1 can be queried (the CCLI usage report is a join) and foreign keys can be used. The
  sync design does not shape the data; the Worker maps between the two (D1_PHASE1_PLAN.md, decision 1).
- **No counter and no per-team tables.** Every row carries a `change_id`, a ULID set on each write. It is both
  the revision and the change feed's position, and a pull re-reads a few seconds back, which the engine
  tolerates, so two Workers that commit out of order lose nothing.
- **ULIDs for all new ids**; existing uuids stay as they are. The primary keys lead with `space_id`, so rows
  cluster by space either way.
- **`space_id` is a team's or a personal space's.** A polymorphic key, which SQLite does not enforce; the
  Worker checks the space exists and who may write it. The alternative is one `spaces` table with a kind, and
  `teams` as its detail: cleaner, but it moves the register, which outlives its teams on purpose.
- **Setlist ids are unique across spaces** (`space_setlists.setlist_id`), which the app's lookup relies on.
- **`space_setlist_songs` carries `title` and `ccli`** copied from the song, so a setlist is readable on a
  device that does not have the song (decided in CENTRAL_STORAGE.md).
- **Preferences are per key** (`account_prefs`) so two devices changing different settings do not
  overwrite each other; hardware settings hang off `account_devices`. **Overlays are per setlist**
  (`setlist_overlays`), and only the owning account can read or write its rows, in a Team too.
- **`teams.root_ref` and `team_refs` stay**, for the Drive folder that still holds songs and pads. The
  proposed `teams.storage_v2` is only for the move and is not in the final shape.

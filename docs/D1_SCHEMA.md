# The D1 schema: the proposed final shape

![The D1 schema](D1_SCHEMA.svg)

The schema **as it is after `0011_schema_cleanup.sql`**, with every column, foreign key, `CHECK` and index, generated from
the migrated database: [D1_SCHEMA_0011.svg](D1_SCHEMA_0011.svg). The picture above is where it is going.

Grey tables exist today (`migrations/0001` to `0010`); the colours are the phase that adds each one (the CCLI usage report, phase 2, needs no table of its own)
([CENTRAL_STORAGE.md](CENTRAL_STORAGE.md), [D1_PHASE1_PLAN.md](D1_PHASE1_PLAN.md)). The foreign keys, `CHECK`s and
indexes are written out in [SCHEMA_AUDIT.md](SCHEMA_AUDIT.md), section 3, and the team tables are drawn as they
should be after the clean-up.

Choices worth reviewing:

- **One table per kind of record**, each with a `space_id`: `space_songs` (the index, no chords or lyrics),
  `space_setlists`, `space_setlist_songs` (a setlist's entries as rows), `space_people` and `space_pad_sets`.
  Real columns mean D1 can be queried (the CCLI usage report is a join) and foreign keys can be used.
- **No change feed and no tombstones.** A space's data is read whole, in one query per table
  (D1_PHASE1_PLAN.md, "Space data and its sync"), so a deleted row is just absent. `version` is only there so a
  write based on an out-of-date row is refused (409); `modified_at` is for people, the ETag and reports.
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
  proposed `teams.storage` is only for the move and is not in the final shape.

## As built in 0012 (step 1)

`migrations/0012_space_data.sql` follows the picture above with these differences: the column is `song_key`, not `key`
(`KEY` is an SQL word); `space_setlist_songs` also has `extra`, the rest of an entry kept as it came; `space_people`
has `team_member`; `space_songs` has `variant_label` (a version list shows it); the JSON columns are `CHECK`ed to be
the kind of JSON they hold; there is no `space_seq` (no change feed). `teams` gains `storage` (`'drive'` or `'d1'`), which
exists only for the move. `0013_space_data_versions.sql` adds a trigger to each of the four tables that refuses an update
whose `version` is not the old one plus one (`stale_version`): that is how a write made from an out-of-date record is refused.

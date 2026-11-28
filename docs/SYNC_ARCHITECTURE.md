# Sync Architecture

**Status (2026-11-28): the Google Drive sync is gone.** Every space syncs with Chordless: a church's team and a
Personal space that has moved sync with the Worker (`space-data-runtime.ts`). This page said how the Drive sync worked
(a full sync of files, a feed of changes, a check of the folder); that sync, its engine (`sync-manager.ts`,
`sync-orchestrator.ts`, `sync/*`) and its screens were removed in the steps of docs/DEVICE_LIBRARIES.md, and are in the
git history if they are needed.

## How a space syncs now

- **On each device:** IndexedDB, one `ChordlessDB` per space (setlists, songs, chord charts, people, scores, and
  per-setlist device state in `setlist_local`). The app works offline from this: a save lands there first.
- **On the server:** D1 keeps accounts, churches, teams, people, setlist and library metadata; R2 keeps charts, lead sheets
  and pad audio (docs/CENTRAL_STORAGE.md). Source PDFs stay out of routine sync.
- **The outbox:** a save puts its record in an outbox (`SpaceDataStore`), and `SpaceDataSync` sends what is waiting and
  pulls what changed (`space-data-runtime.ts` runs one per space: at start, after a save, on the live channel's "changed",
  and from the Sync button of a space's card).
- **A Personal space still linked to a Drive folder** moves by itself at its next sync once its person is signed in
  (`switch-to-chordless.ts`): what the device has goes up, what the server has comes down, and Drive is never synced again.
  The Drive files are left for "Delete Google Drive files" on the space's card.
- **A church's teams** share the church's library and keep their own setlists. A team's people and roles are the church's
  (the church page); the team's device copy syncs setlists, and a team that moved into its church is learnt of by a device
  that was away (`learnOfMove`, `team-memberships.ts`).
- **Live:** the channel carries only "changed", never a setlist, chart or key (docs/LIVE_SYNC.md).

## What is not synced

Source PDFs, and a device's own preferences and per-setlist state (docs/PERSONAL_LAYER.md).

## What Drive is still for

Signing in with Google; the Worker's proxy of old share links (`/s/<id>`), which still open but no longer update; and
deleting the files a moved space left behind. Drive team routes on the Worker answer "moved to its church" for a team that
has moved.

## Tests

`space-data-*.test.ts` (the outbox and sync of a space), `church-team-live.node.test.ts` and the other Worker tests (run
in workerd), and the Playwright tests. See docs/TESTING.md.

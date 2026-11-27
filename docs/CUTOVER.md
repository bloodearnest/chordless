# Moving the Drive teams into a church (step 8)

The one-off move of the existing Teams, which are kept in Google Drive, into one church on Chordless. It is run by the owner,
once. (The design is docs/CENTRAL_STORAGE.md, step 8, and docs/CHURCH_TEAM_DESIGN.md, "Existing Teams: one church".)

## What it does

1. The **church** is made in the app (Account and Teams → the church console): its name, country, city, postcode if it has one, and
   the CCLI licence number. Making it also makes a team of its own (below).
2. Each existing Drive team is **adopted** by it (`POST /api/churches/<church>/teams/<team>/adopt`, the button in the church
   console): its members become the church's members (the higher role where a person is in both), and the team becomes one of
   the church's, keeping its id, so its setlist URLs and the spaces on devices carry on. One change; asking again does nothing.
   Only an admin of the church who is also an admin or the owner of the team may.
3. Each **device follows** at its next check of the teams it is in (when the app opens, or after fifteen minutes away): it queues
   each of its setlists to be created in the church (with each leader linked to the member of the same name, or kept as a name in
   words), sends its songs to the church's library, says so in a note, takes what the church has, and does not use Google Drive for
   that team again. Every device of a team holds the same songs and setlists under the same ids, so what several send is one thing.
4. An app that is not updated, asking the Drive routes for an adopted team, is told **"This team has moved to its church on
   Chordless: update the app to carry on"**, and nothing it sends is taken.

**Identical songs are merged as they arrive.** Both teams kept the same songs, each under its own ids. When a device sends a song
the church's library already has (the same chart, under another id), the Worker does not add it again: it says which song is
there (`mergedInto`), and the device points its setlists at that song, drops its own copy, and takes the one that is there. Whichever
team's device sends first decides which id stays, and two sending at once are settled by the database, so it does not matter which
team is adopted first or whether devices follow together. A chart that differs, even by a word, is a different song and is kept as
it is (a variant); merging those is for a person to do.

Not done by the move, on purpose: pads are not carried (they are uploaded again to the church's library), the existing Drive share links end (make new ones), and
a member's private annotations and capo stay on their device until church-team overlays sync.

## Before

- **A backup:** `just backup` and `just db-backup`, then a copy of `.backups/` somewhere else (docs/BACKUP.md).
- **Everyone updates the app** and opens it once while online, so each device has synced Drive. Tell them it will say the team
  moved, and to leave the app open until it has finished (a minute).
- Decide the church's details, and which team's CCLI licence number it carries.

## The steps

1. In the church console, make the church. It makes a team of its own: archive it (or rename it and use it), so that no one is
   given an empty extra space.
2. Adopt each of the two teams.
3. Open the app on your own device and wait for the note and for "Synced".
4. Check the counts on the team's card (songs, setlists) against what you had, open a few setlists, and look at the leaders.
5. Ask the others to open the app. Each does the same; check their counts match yours.
6. After a week of use, and a fresh backup, delete the Drive files (the card's "Delete Google Drive files").

## If it goes wrong

- A device that stopped partway: open the app again; the move carries on from where it was (what was sent is not sent twice).
- The server's side is one change per team: **to undo it**, set `teams.church_id` to NULL for the team (`wrangler d1 execute`), and
  the Drive routes see it again. Devices that already followed keep working with the church's data and do not go back to Drive.
- To go back to before everything: restore the database (docs/BACKUP.md, "Restoring"), and Drive still has every file.

## Rehearsed

On a local Worker with a D1 and R2 of its own, with two browser "devices": a church adopted two Drive-style teams; the owner's and
a member's devices, with overlapping songs and setlists (and a song and a setlist only the member's device had), each followed by
itself. The server ended with the union (three songs, none twice; three setlists with their ids), leaders linked to accounts or
kept as a name, and both devices held everything. Then one device with both teams, the same three charts under different ids in each,
adopted team A and then team B: the church library held three songs, not six, and both teams' setlists named them.

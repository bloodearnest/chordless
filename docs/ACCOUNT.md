# Account and Teams

The page that was "Storage" (`/storage`): who you are signed in as, and the spaces on this device
(a **Personal** space and any **Teams**) with what to do with each. **Built 2026-10-22.** The words
people see are in docs/SPACES.md, "Naming": the UI says Personal and Team, the code and these docs
say space.

Where the code is: `account-page.ts` (the list), `account-card.ts` (the account), `space-card.ts`
(one space on the list), `space-manager.ts` (everything to do with one space, shown in a modal), `storage-summary.ts` (the device), and
`media-page.ts` (the media player and the pad sets). `/storage` still opens the page (an alias in
`router.ts`). The panels for sync, export and import and people take the space they are given
(`drive-sync-panel.ts`, `space-export-panel.ts`, `team-share-panel.ts`), and a sync manager made for
a space works on that space, not the one in use (`sync-manager.ts`). Differences from the sketch
above: "Manage" on the account is an inline disclosure, not a sheet; a card's Sync button is shown
for any space once syncing can work, and the card runs the sync itself (`space-sync.ts`).

## Why it changes

`/storage` is eight panels stacked in one column, and they mix three scopes with no signposting:

| Scope | Where it is today |
|---|---|
| The device | Local Data (the browser's usage), Clear Local Data, the delete-a-space list |
| The account | Google Drive Authorization, including "Test Token Refresh" and the auth backup |
| One space | Space switcher, Sync, Team Space, Export and import, Pad Sets (account-level for now) |

The space panels all act on the space in use, and say nothing of which that is. To do anything to
another space you must switch to it, which shows its home page. A space's operations are in five
panels, and its size is nowhere. A signed-out person (a normal state) sees the sync, team and
export panels turn into "connect above" hints. Developer tools sit in the main UI. And the switcher
marks the current space by comparing names, not ids, so two spaces called the same both read
CURRENT.

## The page: `/account`, "Account and Teams"

```
Account and Teams

+- Account ----------------------------------------------+
| Bea Singer - bea@example.com                           |
| Google Drive connected                      [Manage]   |
+--------------------------------------------------------+
  signed out: "Not signed in. Your songs stay on this device."  [Sign in with Google]

+- Bea Singer [Personal]                        Current -+
| 31 songs - 6 setlists - about 190 KB                    |
| Synced 5 min ago                      [Sync] [Manage]   |
+--------------------------------------------------------+
+- Gateway Church [Team] [owner]                         +
| 212 songs - 48 setlists - about 1.4 MB                  |
| Sign in to sync          [Manage]                [Switch] |
+--------------------------------------------------------+

[Create a new Team]           (rare: under the Teams, not above them)

This device
  Browser data 2.1 MB - App cache 6 MB - Media cache 180 MB
```

- **The account card** is a prerequisite shown first, and it can be empty (anonymous). Its "Manage"
  sheet has reconnect, connect Drive and log out. "Test token refresh" and the auth backup
  (download, import) are under an *Advanced* disclosure.
- **Signed out disables nothing.** The Personal space, export, import and delete all work; a card's
  sync line says "Sign in to sync".
- **Cards:** in the order the spaces were added (the Personal space is always first), whichever is in use; the one in use says Current and the others have Switch. A personal
  space's name is the account name once signed in (`first-time-auth.ts`); one still called
  "Personal" shows just "Personal". A team shows the person's role.
- **Switch** (not "Open") is the word. It does not reload the app: it shows the home page afresh in that space.
- **Sizes** are estimates: IndexedDB reports usage for the whole origin only, so a space's size is
  its records (setlist JSON and chart text), as the team wizard's "Bring across" step counts them.
  "This device" is the browser's own total; the caches (app, media) belong to it, not to a space.
- **"Create a new Team"** goes to `/account/new` (the wizard, docs/SPACES.md "Creating a team
  space"). There is no conversion of a personal space.

## One space's Data modal, and a Team's Users modal

"Data" on a card (it was "Manage") opens a modal over the list, like the app's other settings (Preferences, Help, the
info dialogs): not a page of its own with a back button. Whether the app should move to forward/back
settings pages everywhere is a decision for the whole app, not for this feature, so this follows what
it has. The cost is that a space's management has no address of its own.

```
+- Gateway Church ---------------------------------------- x -+
| [Team] [owner]                                     Current  |
| 31 songs - 6 setlists - about 190 KB                         |
|                                                              |
| Google Drive   [Reset from Google Drive]  Start over...      |
| Export and import   [Export...]  [Import...]                 |
| Delete from this device   [Delete...]                        |
+--------------------------------------------------------------+
```

The space's name is the modal's heading. On the list, the kind (Personal, Team) and the person's role
in a Team are labels after the name on the left, Current is flush right where it never moves, and Switch is flush right on the card (not in the modal: sync and switch are the card's). It works
for any space, not only the one in use, so nothing is switched to be managed. That is possible
because the first sync takes the space's own database (`syncTeamSpace`), export and delete need only
that database, and the people and invite calls need only the team id. Every destructive action asks
first (CLAUDE.md: friction, not prohibition). Deleting a space closes the modal (`SpaceGoneEvent`)
and the list is read again; closing it any other way reads the list again too.

A Team's people are in a second modal, from a **Users** button on a Team's card (after Data): who is in
it and their roles, invite someone, invites waiting, stop sharing, and leave. Every member gets the
button, not only those who may manage people, because leaving is there and a member can see who is
in the Team. The controls inside follow the role. Leaving, or closing the modal, reads the list again.

## Pad sets and the media player: their own page, `/media`

Decided 2026-10-22. The media player gets a page of its own and a **permanent** menu entry, so it
can be found and switched on. **Everything about the media player is on that page and nowhere in
Preferences**: the enabled switch at its top, then (when it is on) the settings (pads, metronome,
stereo split) and the Pad sets (upload, list, delete). The page shows nothing of pads while the
player is off. The player's own settings popover keeps using the same settings component. Pad sets
leave the Account and Teams page: they are the account's today (docs/STORAGE_API.md), the one large
thing in the device's cache, and useful only with the player. When pads become per-space
(docs/SPACES.md, item 6) they move into each space's Manage modal.

## What changes in the code

1. A per-space summary (`spaceSummary(id)`: counts and estimated size) and a card component. The
   current-space marker compares ids.
2. `drive-sync-panel`, `space-export-panel` and `team-share-panel` take a `space` property instead
   of reading the current space; the sync panel runs `syncTeamSpace`-style (the space's own database).
3. The list page, the Manage modal and the account card; `/storage` opens `/account`; the
   seven links to `/storage` (menu, welcome card, sync panel, share dialog, space access, media
   player settings) and the e2e and unit tests move with it.
4. The routes in docs/ROUTING.md, the naming in docs/SPACES.md and CLAUDE.md (done), and the
   status lines here.

## Decided

Decided 2026-10-22: there is no "clear everything on this device"; a space is deleted one at a time,
from its Manage modal, after a confirmation. The media page's menu entry is always shown.

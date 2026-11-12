# Account and Teams

The page at `/account` (`/storage`, its old address, still opens it): who is signed in, and the spaces
on this device, a **Personal** space and any **Teams**, with what to do with each. Built 2026-10-22,
and brought up to date 2026-11-12. The words people see are in docs/SPACES.md, "Naming": the UI says
Personal and Team, the code and these docs say space.

It replaced a `/storage` page of eight panels in one column that mixed three scopes (the device,
the account, one space) and acted on the space in use without saying which it was. This page
keeps the scopes apart: the account first, then one card per space, then the device.

## Where the code is

| File | What it is |
|---|---|
| `account-page.ts` | The page: the list, and the modals below |
| `account-card.ts` | The account |
| `space-card.ts` | One space on the list |
| `space-manager.ts` | **Data**: everything to do with one space's data, in a modal |
| `space-people.ts` | **Leaders**: who leads a space's setlists, in a modal |
| `team-share-panel.ts`, `team-licence-panel.ts`, `team-storage-panel.ts` | **Users**: a Team's people, its CCLI licence number and its storage, in a modal |
| `drive-sync-panel.ts`, `space-export-panel.ts`, `space-delete-everywhere.ts` | The panels of the Data modal. Each takes the space it is given, and a sync manager made for a space works on that space, not the one in use (`sync-manager.ts`) |
| `storage-summary.ts` | The device |
| `team-space-wizard.ts` (`/account/new`), `team-join.ts` (`/join`) | Making a Team, and joining one: docs/SPACES.md |
| `media-page.ts` (`/media`) | The media player and the pad sets |

## The page

```
Account and Teams

+- Account ----------------------------------------------+
| Bea Singer - bea@example.com                           |
| Google Drive connected                      [Manage]   |
+--------------------------------------------------------+

Personal and Team Spaces
+- Bea Singer [Personal]                        Current -+
| 31 songs · 6 setlists · about 190 KB                    |
| Synced 5 min ago                                        |
| [Sync] [Data] [Leaders]                                 |
+--------------------------------------------------------+
+- Gateway Church [Team] [owner]                          +
| 212 songs · 48 setlists · about 1.4 MB                  |
| CCLI licence 471102                                     |
| Synced 2 min ago                                        |
| [Sync] [Data] [Leaders] [Users]                [Switch] |
+--------------------------------------------------------+

To join a Team, open the invite link its admin sent you.
[Create a new Team]

This device
  Browser data 2.1 MB · App cache 6 MB · Media cache 180 MB
```

### The account card

Shown first, and it can say that no one is signed in, which is a normal state ("Not signed in. Your
songs stay on this device." and **Sign in with Google**). Signed in, it shows the name and address and
whether Google Drive is connected: **Connect Google Drive** if the sign-in has no Drive, **Reconnect
with Google** if it has expired. **Manage** is an inline disclosure with **Log out** (this device
only) and **Revoke access on all devices**. Google keeps one grant per account, so revoking it ends
every device's sign-in, and logging out must not, or one device's logout would sign out the rest with
`invalid_grant`. Under **Advanced**, for when something is wrong: a token refresh test, and the
sign-in backup (download, import).

### The spaces

- **Cards** are in the order the spaces were added (the Personal space is always first), whichever is
  in use. The one in use says **Current**. A card says the kind (Personal, Team) and, for a Team, the
  person's role, as labels after the name; Current is flush right where it never moves. A personal
  space's name is the account name once signed in (`first-time-auth.ts`); one still called "Personal"
  shows just "Personal".
- **A card's lines:** how much the space holds (estimated: IndexedDB reports usage for the whole
  origin only, so a space's size is its records, setlist JSON and chart text, as the team wizard's
  "Bring across" step counts them), a Team's **CCLI licence number** if it has one
  (docs/CCLI.md), and how the sync stands: when it last ran, its progress
  while it runs, or what stands in the way ("Sign in to sync", "Sign-in expired: reconnect to sync",
  "Connect Google Drive to sync").
- **Sync** is on the card, and the card runs the sync itself (`space-sync.ts`). It is shown for any
  space once syncing can work: a sign-in with Drive, or for a Team's member a sign-in alone.
- **Data**, **Leaders** and (for a Team) **Users** open the modals below. **Users** is shown to every
  member, not only those who manage people, because leaving is there and any member can see who is in
  the Team; the controls inside follow the role.
- **Switch** (not "Open") is the word. After a confirmation it makes that space the one in use and
  shows the home page afresh in it, without reloading the app. It is the second way to switch: the
  main one is the tabs under the header of the Setlists, Library and Add Song pages
  (`space-tabs.ts`, docs/SPACES.md, "Space tabs"), which show only spaces with something in them.
  So this button is the way to a space that has no tab, such as an empty Personal one.
- **Signed out disables nothing that works without an account.** The Personal space, export, import
  and deleting from the device all work. Sync is not offered, and **Delete everywhere** is disabled
  (it needs Drive); a card's line says "Sign in to sync".
- **Create a new Team** goes to `/account/new` (the wizard, docs/SPACES.md, "Creating a team space").
  It is rare, so it is under the spaces and not above them. A personal space is never converted. To
  join a Team you open the invite link its admin sent: `/join`.

### This device

The browser's own total for the app's data, and the caches (the app, and media), which belong to the
device and not to a space.

## Data: one space's modal

**Data** on a card opens a modal over the list, like the app's other settings (Preferences, Help, the
info dialogs), not a page of its own with a back button. Whether the whole app should move to settings
pages with forward and back is a decision for the app, not for this page, so it follows what the app
has. The cost is that a space's management has no address of its own.

```
+- Gateway Church ---------------------------------------- x -+
| [Team] [owner]                                     Current  |
| 31 songs · 6 setlists · about 190 KB                         |
|                                                              |
| Team copy / Google Drive                                     |
|   [Reset from Google Drive]                                  |
| Export and import   [Export...]  [Import...]                 |
| Delete from this device   [Delete...]                        |
| Delete everywhere         [Delete everywhere...]             |
+--------------------------------------------------------------+
```

The space's name is the modal's heading. It works for any space, not only the one in use, so nothing
is switched to be managed: the first sync takes the space's own database (`syncTeamSpace`), export and
delete need only that database, and the people and invite calls need only the team id. Every
destructive action asks first (CLAUDE.md: friction, not prohibition). When a space is deleted the modal
closes (`SpaceGoneEvent`) and the list is read again; closing it any other way reads the list again too.

- **Google Drive** (a Team's is "Team copy"): **Reset from Google Drive** replaces this device's songs
  and setlists with Drive's, after saying what it will lose. Syncing itself is the card's. When the
  space's Drive folder is gone or in the trash (as after "Delete everywhere" from another device) the
  panel says "Drive folder not found" and offers the way on: **Start over in Drive** keeps everything on
  this device and uploads it again to a new folder (share links to its setlists stop working), and
  **Replace with the copy in Drive** takes the folder of the space's name that another device has
  already synced. Each shows its progress (`progress-bar.ts`, the bar the pages that make or join a
  Team use) and asks first.
- **Export and import** (`space-export-panel.ts`): the space's songs and setlists as a zip, which needs
  no Google account, and an import of one, which only adds what is missing (docs/SPACES.md,
  "Export and import"). With the media player on and Drive reached, it can include the pad sets.
- **Delete** (below).

## Leaders

**Leaders**, on every card (after Data), is `space-people.ts` in a modal: who leads a space's setlists
(docs/IDENTITIES.md, "People page").

## Users: a Team's people, licence and storage

**Users**, on a Team's card (after Data), opens a modal of three panels:

- **People** (`team-share-panel.ts`): who is in the Team and their roles, and for those who may manage
  people, **Invite someone** (an email and a role; the link, shown once, with a **Send…** button for the
  share sheet or WhatsApp or Gmail), the invites **waiting to be used** and a way to revoke each. The
  owner can **stop sharing**, and any other member can **leave**. A role acts only on those below it (the
  Worker's rule, docs/SPACES.md, "Roles"; the controls shown follow it).
- **CCLI licence number** (`team-licence-panel.ts`): anyone sees it, a writer sets it where there is
  none, an admin changes or clears it and sees the log of changes (docs/CCLI.md).
- **Team storage** (`team-storage-panel.ts`, the owner only): how the Team's folder is reached, the
  owner's own Google sign-in or Chordless's service account on a shared drive, with the address to
  add and **Check and switch** (docs/SPACES.md, "Credentials").

Leaving, stopping sharing, or closing the modal reads the list again.

## Deleting a space

Two ways, both on the Data modal, and **both work on any space, the one in use included**: it is not a
reason to refuse. The one in use is replaced by another (or none: Personal is made again when the app
needs one), and the page starts again in it, as a switch does (`SpaceGoneEvent.wasCurrent`). The old
rule "switch to another first" was about an open database connection, which the app already lets go of.

- **Delete from this device** removes the space's database here and leaves its Drive folder alone. A
  Team's member stays in the Team and can have it back with a new invite link.
- **Delete everywhere** (`space-delete-everywhere.ts`; the rules and the Worker's part are docs/SPACES.md,
  "Deleting a space"): the Drive folder goes to the Drive trash, then the space goes from the device. For
  a Team it is for an **admin or the owner**, and ends sharing. It asks for a **backup** it makes itself
  (an export, handed to the browser), the space's **name typed**, and a press of a button that says what it
  does. It needs Drive reached (a sign-in with Drive; for a Team a sign-in alone), so it is disabled while
  signed out.

There is no "clear everything on this device": a space is deleted one at a time (decided 2026-10-22).

## Pad sets and the media player: their own page, `/media`

Decided 2026-10-22. The media player has a page of its own and a **permanent** menu entry, so it can be
found and switched on. **Everything about the media player is on that page and nowhere in
Preferences**: the enabled switch at its top, then (when it is on) the settings (pads, metronome,
stereo split) and the pad sets (upload, list, delete). The page shows nothing of pads while the player
is off, and the player's own settings popover uses the same settings component. Pad sets are not on the
Account and Teams page: they are large, the biggest thing in the device's cache, and useful only with
the player. Every space keeps its own, in its own folder (`<space folder>/pads/`, a personal space's as
well as a Team's: docs/SPACES.md, "Pads in team spaces"). The media page lists the sets of every space
on the device, grouped under the space's name when there is more than one, and the upload form has "Save
to" for the space the set goes in.

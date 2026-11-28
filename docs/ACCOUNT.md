# Account and Teams

**Status (2026-11-28): the Drive screens are gone; this page is to be redone for churches.** Every team is a church's,
kept on Chordless, and a Personal space moves there by itself (docs/CENTRAL_STORAGE.md, step 10), so these were removed:
Create a new Team (`/account/new`, the wizard and its folder picker), the Drive team join page (`/join/<team>/<code>` now
goes to the church's page, which takes the same invite), a team's membership, licence and storage panels (a team's page
links to its church's page), Manage Data's Google Drive panel (reset, start over, replace) and Delete everywhere, and
Connect, Reconnect and Disconnect Google Drive on the Personal card. What follows describes the page as it was; the
redesign is to follow.

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
| `space-page.ts` (`/account/space/<id>`, `space-view.ts`) | One space on a page of its own: the sections below, under **Manage Users** on its card |
| `space-manager.ts` | **Data**: everything to do with one space's data, in the dialogue of **Manage Data** on the card |
| `space-people.ts` | **Leaders**: who leads a space's setlists (a section of the space page) |
| `people-list.ts`, `person-rows.ts` | The one list of a space's people: a Team's members, invites and visiting leaders, or a Personal space's leaders (the first section of the space page) |
| `team-membership-panel.ts`, `team-licence-panel.ts`, `team-storage-panel.ts` | A Team's place for the person (stop sharing, leave), its CCLI licence number and its storage (sections of the space page) |
| `space-export-panel.ts` | The panel of the Data modal (export and import). It takes the space it is given |
| `storage-summary.ts` | The device |
| `team-space-wizard.ts` (`/account/new`), `team-join.ts` (`/join`) | Making a Team, and joining one: docs/SPACES.md |
| `media-page.ts` (`/media`) | The media player and the pad sets |

## Signing in (2026-11-19)

There is one way in, and it is the form of a regular web app: `sign-in-form.ts`.

```
Email              [ you@example.com ]
[ Continue ]                        (we email a link and a six-digit code)
-------------------- or --------------------
[ Continue with Google ]            (also syncs your Personal space, with your Google Drive)
```

Both are the same Chordless account. Google is another way to prove who you are (an address Google has verified joins the
account of an emailed sign-in with the same address: docs/SPACES.md), not a second login, and a Google sign-in asks for Drive
in the same window, so syncing is simply on afterwards ("Google Drive", below). The form is used by the Account page (signed
out), the page a sign-in link lands on (`/sign-in/<id>`) and the page an invite opens (`/join`, with the invite's address filled
in). The join page no longer asks whether the person has a Google account, and an invite no longer says to make one: any
address that can receive an email will do. An **admin** invite still only works with the address it was sent to. A person
signed in as the wrong address chooses **Use a different account**, which logs out first (signing in over a session only adds a
login to the same account).

Not done yet: the other pages that ask for Google by themselves (making a Team, sharing a setlist, deleting everywhere) have their
own Google buttons, since they need Drive, not only a sign-in.

## Google Drive (2026-11-19)

Syncing the Personal space between devices needs a Google Drive, and **the Worker holds the credential for the account**, so a
device needs only a sign-in (an emailed code, or Google) to sync, and never a second Google popup.

- **Where it is:** D1 `account_drive` (migration `0010`, one row per account): the encrypted refresh-token blob (the same
  AES-256-GCM JWE as before: `worker/src/blob.ts`, key `JWE_ENCRYPTION_KEY`), the Google address Drive is reached as (it need
  not be one of the addresses the person signs in with), the scope and the dates. A D1 export alone has no refresh token in the
  clear. It is a credential and not content: the copyright list in CLAUDE.md names it.
- **Made by** a Google sign-in that was granted Drive (`/oauth/callback`, which joins the Google login to the session's account
  and keeps the blob for it; a second one replaces the first), so **Continue with Google** enables sync with nothing more to do.
  Someone who signed in by email connects Drive once, from the Personal space, with the same popup.
- **Used by** `getAccessToken()` (`src/js/google-auth.ts`): it asks `POST /api/account/drive/token` with the session, the Worker
  decrypts the blob and asks Google for an access token (an hour), and the page then talks to Drive itself, as before. The
  Worker handles no song. `404 not_connected` is "no Drive" (state `no-drive`); `401 invalid_grant` or `invalid_blob` is
  `SignInExpiredError`, and **Reconnect** on any one device mends it for all.
- **Disconnect** (`DELETE /api/account/drive`, the button that was **Disable**): the Worker revokes the grant at Google and forgets
  the blob, for every device. It stays signed in. A Team the person owns and keeps in their own Drive holds a copy of the same
  grant (`team_credentials`), so then only the account's row is forgotten and the grant is left at Google (`revoked: false`; the
  card says so); the Team's storage does not stop.
- **Teams** are made from it: `POST /api/spaces` and `PUT /api/space/<id>/credential` take no blob from the page (one sent by an
  app from before is still read) and use the account's row, `409 not_connected` if it has none.
- **Devices from before** (a blob kept in the service worker's `auth` IndexedDB): the first `getAccessToken()` sends it to
  `POST /api/account/drive/adopt`, which keeps it for the account if the blob's Google login is on that account (`409
  google_in_use` otherwise, so a blob is not a way to take another's) and unless another device has connected since, and the
  device forgets it. A failure (offline, say) leaves the blob to be sent next time. **Removed 2026-11-19:** `/oauth/callback` sending the blob to the
  page, `/session/refresh` (a blob in, an access token out) and the client's fallback to it, and the blob variant of
  `/session/logout` (signing out only ends the session; the Drive connection is disconnected on its own). An app from before that
  has not reloaded since asks a route that is gone: it reloads, and signs in again if it must. `/session/upgrade` (a blob in, a
  session out) and `adopt` stay for as long as a device might still hold a blob.
- The device keeps `metadata.drive` (whether the account has Drive, as the Worker last said: `GET /api/account` has `drive:
  {email}`), asked after a sign-in and corrected by the token route. The Personal card's three kinds of state follow: connected,
  not connected (`no-drive`), expired.

## The page

```
Account and Teams

+- Account ----------------------------------------------+
| Name    Bea Singer                          [Edit]     |
| Emails  bea@example.com                                |
|                                             [Log out]  |
+--------------------------------------------------------+

Personal and Team Spaces
+- Personal                                     Current -+
| 31 songs · 6 setlists · about 190 KB                    |
| Synced 5 min ago                                        |
| Google Drive: bea@gmail.example                         |
| [Sync] [Manage] [Disconnect Google Drive]               |
+--------------------------------------------------------+
+- Gateway Church [Team] [owner]                          +
| 212 songs · 48 setlists · about 1.4 MB                  |
| CCLI licence 471102                                     |
| Synced 2 min ago                                        |
| [Sync] [Manage]                                [Switch] |
+--------------------------------------------------------+

To join a Team, open the invite link its admin sent you.
[Create a new Team]

This device
  Browser data 2.1 MB · App cache 6 MB · Media cache 180 MB
```

### The account card

Shown first (`account-card.ts`, redesigned 2026-11-18), and it can say that no one is signed in, which is a normal state ("Not
signed in. Your songs stay on this device." above the one sign-in form: "Signing in", above). Signed in, it has two rows and
**Log out**; it says nothing of Google or of syncing, which belong to the Personal space (2026-11-19):

- **Name**: the name they gave, with **Edit** (or "Not set" and **Add your name**). It is kept at the Worker (`accounts.name`, migration
  `0008`; `GET` and `PUT /api/account`, `worker/src/account.ts`), so it is the same on every device. Google's name is taken at a
  first Google sign-in as a start and never replaces one they gave. A person signed in with no name is asked once a visit, in a
  modal ("What should we call you?", `name-prompt.ts`, `account-name.ts`), not on the join page, where they are in the middle of
  something: Google need not say a name, and an emailed code never does.
- **Emails**: every address the account signs in with, none marked as a separate login. Read from the Worker, kept on the device
  (`account-info.ts`) so it shows offline.

**Log out** forgets the sign-in on this device (the session, which is ended at the Worker, and what was kept of the account),
and nothing more: the account's Google Drive connection is the Worker's, so signing in again, on any device, carries on syncing. **Removed 2026-11-18:** "Revoke access on all devices" (which is now what **Disconnect Google Drive** does), and the **Advanced** section: the token refresh test and
the sign-in backup (download, import), which were for fixing a sign-in and are not needed: signing in again is the fix.

### The spaces

- **Cards** are in the order the spaces were added (the Personal space is always first), whichever is
  in use (no card is marked "Current": the app shows every space at once, 2026-11-20). A card says the
  kind (Personal, Team) and, for a Team, the person's role, as labels after the name. A personal
  space is called "Personal", and stays so (decided 2026-11-18: it was renamed to the person's name at a first sign-in,
  an idea from before Teams; now "Personal" and "Team" say what each is). A Personal space someone's name was given to
  before then keeps it.
- **A card's lines:** how much the space holds (estimated: IndexedDB reports usage for the whole
  origin only, so a space's size is its records, setlist JSON and chart text, as the team wizard's
  "Bring across" step counts them), a Team's **CCLI licence number** if it has one
  (docs/CCLI.md), and how the sync stands: when it last ran, its progress
  while it runs, or what stands in the way ("Sign in to sync").
- **Google Drive**, on a Personal card only (2026-11-19: it was the Account card's Enable, Disable and Reconnect, and a Connect
  Google button; a Team's card never has it, since a Team syncs through the Worker): "Google Drive: bea@gmail.example" with
  **Disconnect Google Drive** while it is connected (`SpaceDisconnectDriveEvent`; the page asks first, and it goes for every
  device); "Google Drive is not connected, so this space does not sync between your devices." with **Connect Google Drive**
  when it is not; "Google Drive needs reconnecting to sync." with **Reconnect Google Drive** when Google no longer honours it
  (`SpaceConnectDriveEvent`). Connecting is Google's whole sign-in for an account with no Google login yet (it joins the
  account, whatever its address) and Drive's box asked for alone for one that has (so it cannot be left unticked); either way
  the page (`account-page.ts`) does it, and says what went wrong in a toast.
- **Sync** is on the card, and the card runs the sync itself (`space-sync.ts`). It is shown for any
  space once syncing can work: a sign-in with Drive, or for a Team's member a sign-in alone.
- **Manage Users** goes to the space's own page (below), and **Manage Data** opens a dialogue over the list with the space's
  data (export, import, reset from Drive, delete: `space-manager.ts`). The page is only for people, the Team's own panels and
  its licence and storage; the data is apart because it is rarely wanted and has nothing to do with who is in the Team.
  Manage Users It is shown to every member, not only those who manage
  people, because leaving is there and any member can see who is in the Team; the controls inside follow the role.
- **There is no Switch** (removed 2026-11-20): the Setlists and Library pages show every space, and
  a setlist or song opens in its own space (docs/SPACES.md, "Space tabs"). Creating or joining a Team
  still makes it the space in use afterwards, because sync follows the space in use until it syncs every
  space (docs/CENTRAL_STORAGE.md, phase 0).
- **Signed out disables nothing that works without an account.** The Personal space, export, import
  and deleting from the device all work. Sync is not offered, and **Delete everywhere** is disabled
  (it needs Drive); a card's line says "Sign in to sync".
- **Create a new Team** goes to `/account/new` (the wizard, docs/SPACES.md, "Creating a team space").
  It is rare, so it is under the spaces and not above them. A personal space is never converted. To
  join a Team you open the invite link its admin sent: `/join`.

### This device

The browser's own total for the app's data, and the caches (the app, and media), which belong to the
device and not to a space.

## The space page: `/account/space/<id>`

**Manage Users** on a card goes to a page of its own for that space (`space-page.ts`; `docs/ROUTING.md`), which replaced
three modals (Data, Leaders, Users, 2026-11-17): a modal has no address, no back button and no link, and could not
hold a list of people beside an editor for one of them. The id is this device's own for the space, so a link works only
here; a space that is not on this device says so, with a link back.

```
<- Account and Teams
Gateway Church  [Team] [Worship leader]

  People: members, invites, visiting leaders (a Team);       people-list.ts
          who leads the setlists (a Personal space)
  Your place in the Team (a Team): stop sharing / leave     team-membership-panel.ts
  CCLI licence number (a Team)                              team-licence-panel.ts
  Team storage (a Team's owner)                             team-storage-panel.ts
```

It works for any space on the device, not only the one in use (nothing is switched to manage it): the first sync takes the
space's own database, export and delete need only that, and the people and invite calls need only the team id. Every
destructive action asks first (CLAUDE.md: friction, not prohibition). Deleting the space (from Manage Data) closes its dialogue, and the person leaving the
Team goes back to the list (to the home page, afresh, if it was the one in use: `SpaceGoneEvent.wasCurrent`).

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

### A Team's sections

- **People** (`people-list.ts`): who is in the Team and their roles, and for those who may manage
  people, **Invite someone** (an email and a role; the Worker emails the invite, and the link is shown once, with a **Send…**
  button for the share sheet or WhatsApp or Gmail), the invites **waiting to be used** with **Send again** and **Revoke**. The
  owner can **stop sharing**, and any other member can **leave** (`team-membership-panel.ts`). A role acts only on those below it (the
  Worker's rule, docs/SPACES.md, "Roles"; the controls shown follow it).
- **CCLI licence number** (`team-licence-panel.ts`): anyone sees it, a writer sets it where there is
  none, an admin changes or clears it and sees the log of changes (docs/CCLI.md).
- **Team storage** (`team-storage-panel.ts`, the owner only): how the Team's folder is reached, the
  owner's own Google sign-in or Chordless's service account on a shared drive, with the address to
  add and **Check and switch** (docs/SPACES.md, "Credentials").
- **Leaders**, on every space (`space-people.ts`): who leads a space's setlists (docs/IDENTITIES.md, "People page").

### People: one list (built 2026-11-17: `people-list.ts`, `person-rows.ts`)

The People and Leaders sections become **one list of a space's people** (a Team's members, their pending invites, and visiting
leaders who are not members), one row each: name, first address (and "+n"), role, **Edit**. A table that can be sorted by name,
role or status on a wide screen and stacked cards on a phone, with a search box once there are more than about eight people. Rows:

- a **member**: their name (from the synced people record), the address they signed in with, their role;
- a **pending invite**: the address, the role, "Invited · 6 days left" and "Emailed 2 days ago" or "Not emailed"
  (`team_invites.emailed_at`, to add), with **Resend** (a new invite for the address replaces the old, and is emailed:
  the code is never kept, so the old link cannot be sent again; the confirmation says the old link stops working),
  **Copy link** (of the new one) and **Revoke**;
- a **visiting leader**: a person who leads setlists but is no member, "Not a member", with **Invite** in their editor.

**Edit** opens one modal for one person: the name; their addresses (the person record's: each with an ×, and a field to add
one: they match the email import and recognise the member); the addresses the Team knows the member by shown read-only
("signed in with", "invited as": they prove who someone is, so an admin does not edit them, and no Worker route is needed);
the role (only those below your own); **Remove from the team**, **Merge into…** and **Delete person** (only for one who leads
nothing and is not you), each after a question. Rules are unchanged: a role acts only on those below it, a team member sees
the list and names themselves, and the list is built from the cached members and local people, so it shows offline (role
changes and invites say they need a connection). **Invite someone** is a button over the list.

Layout (2026-11-18): **Members and Invites are two tables**, so the search box (of the members) and **Invite someone** (of the
invites, in its heading) no longer look like related controls. Members have name, every address (small, one under another),
role (a person who only leads setlists says "Not a member") and **Edit**; invites have address, role, status and **Send
again** / **Revoke**, saving width. Text and buttons are small, and nothing says how many setlists a person leads. The
invite dialogue has the address, the role and the button on lines of their own. The person editor has four plain sections:
**Name**, **Email addresses** (remove, and add), **Merge into another person** (with what it does) and **Delete**.

As built (2026-11-17): every space's page shows `people-list.ts` as its first section, for a Team (members, invites, visiting
leaders) and for a Personal space alike; in a Personal space it is only the people who lead setlists (no roles, status or invites,
and view-only if the space is). Beside it a Team has `team-membership-panel.ts` (who you are in the Team, **Stop sharing** or **Leave**,
each after a question), the licence and the storage; stopping sharing makes the page read the space again, as a Personal one. The
editor modal is `space-people` shown for one person (`only`), under a member's role, read-only addresses and **Remove from the
Team**; it tells the list when a person changed (`space-people:changed`). **Send again** makes a new invite and revokes the old; the
invite row's "Emailed 2 days ago" is `team_invites.emailed_at` (migration `0007`), set by the Worker when the mail was handed over.

## Deleting a space

Two ways, both in the Manage Data dialogue of the space's card, and **both work on any space, the one in use included**: it is not a
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

## Deleting an account (not built: by request, 2026-11-17)

The privacy page promises an account is deleted when its person asks (they write to the address on the page).
**There is no button or script for it yet**: the operator does it by hand, after `just db-backup`. What the Worker
holds about an account, by table (migrations/):

| Table | What | On deletion |
|---|---|---|
| `accounts` | the account's id and date | delete the row |
| `account_identities` | each login (`google` sub, `email` address) and its address | delete the account's rows |
| `account_emails` | each address the account owns (0009): the primary key is the address, so **one account to an address** | delete the account's rows |
| `sessions` | refresh-token hashes, address | delete the account's rows (signs out every device) |
| `team_members` | membership in teams (and `invited_as`, the address an invite was made out to) | delete the account's rows (they leave every team) |
| `teams` | an **owner's** team (`owner_account_id`, `owner_email`) | **first** end sharing or hand the team on: a team with no owner cannot be looked after. Then the team's own rows go with it (docs/SPACES.md, "Deleting a space") |
| `team_invites` | open invites **to** an address (`email`) or **by** them (`created_by`) | delete both kinds that name the address |
| `team_events` | the register: a team's creation, licence changes and end, with the address of who did it (`by_email`), and a joined-as-other note with the invited address | the licence record is kept for CCLI (`docs/CCLI.md`, the log of who changed the number); replace the person's address in `by_email` and `detail` with `deleted` |
| `login_codes` | an emailed code's address and code (for three days at most) | goes by itself; delete the address's row |
| `team_credentials` | the owner's encrypted Google token for a team | goes with the team |

Their songs, setlists and pads are on their devices and in their own Drive (the copyright rule, CLAUDE.md):
Chordless holds none, and the deletion does not touch them. The owner's Drive grant is revoked at
myaccount.google.com/permissions.

**To build, if requests come in:** `DELETE /api/account` (signed in, asks for the address typed), which refuses while the
person owns a team (and says which), then deletes the rows above in one batch and the session with them; an Account page
"Delete my account" under Manage with a confirmation and a backup offer. Until then the by-hand list above is the
procedure, and a test that every table holding an address or an account id is on this list would stop it going stale.

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

# Spaces

The single home of the space model: what a space is, where its data lives, who may do what, how
people are invited, how data moves between spaces, and how read-only works. Share links (one
setlist sent to people without an account) are in SHARING.md. How sync itself works is in
SYNC_ARCHITECTURE.md.

> **Status (checked against the code 2026-11-12):** the personal space, the team space for both
> credentials (the owner's token, and team-managed storage on Chordless's service account), roles,
> invites, joining, the Account and Teams page, the tabs, pads per space, a team's changes feed and
> live channel, deleting a space, deleting and moving a setlist, and a device setting up its own teams
> are **built**, and have been tried with real accounts (the service-account teams on 2026-11-12).
> The tests run on fakes. **Not built:** the default space ("Presenting spaces"), bringing pads
> across spaces, the shared-drive choice in the wizard, serialised writes on the Worker, the Worker's
> check of who may delete a song, and a few smaller things listed under
> "Order of work and status". The code and docs call it a space throughout (it was "organisation"
> until 2026-10-20: see "Naming").

## Principle

**Chordless never stores copyrighted content; it only passes access on to it.** Charts, lyrics and pad
audio live in the user's own browser and in a Drive the user (or their team space's owner) controls.
The Worker passes team-space traffic through (streamed, never buffered to storage) without
persisting or caching it: no KV, R2, D1, Durable Object or Cache API entry may hold song or pad
content. They hold only membership, roles, invites, the ids of the Drive files in a team's tree, a
team's CCLI licence number and the log of who changed it, the register of teams (below), the owner's
encrypted token blob, checksums, and, for the live channel, the hash of the secret a share's sender
proved (LIVE_SYNC.md): its sockets carry one word, "changed", and never a setlist, chart or key. (Share
links are the one exception: the Worker caches ciphertext it cannot read.)

Churches using Chordless are expected to hold a CCLI licence, which covers sharing charts with the
members of their church. Each space is self-contained, so copyright compliance is per space.

### The register of teams

A team space's state is in **D1**
(`migrations/0001_team_register.sql`, `0002_team_state.sql`, `worker/src/team-state.ts`), not in a
Durable Object, so it can be asked across teams and outlives them. `teams` has a row per team:
its id, name, owner (account and email), its Drive folder, which credential it uses, its licence
number, when it was made, and when sharing ended (the row stays). `team_members` (account, email,
role, since), `team_invites` (the hash of the code, never the code), `team_refs` (the Drive file
ids in its tree) and `team_credentials` (the owner's encrypted token, a table of its own so a
query about teams never selects it; a team on the service account has no row) are deleted when
sharing ends, so the register that outlives a team names no member. `team_events` is added to and
never changed: `created`, `licence` (from, to, and who) and `ended`. Nothing in D1 is song,
setlist or pad content, and an email other than the owner's is kept only while its member is in
(CLAUDE.md; `src/privacy.html` says so).
- **The Durable Object keeps only the live sockets** (`TeamRoom`, binding `TEAM_ROOM`,
  `worker/src/team-room.ts`), which a hibernating WebSocket needs, and no storage. A socket's
  attachment is its account and space (no email); when a message arrives the room asks D1 for the
  sender's role, and when someone's role changes or they go, the Worker tells the room to close
  their sockets. This replaced `TeamSpace`, whose objects held the state: the migration `v3` in
  `wrangler.toml` deleted that class with everything in it (one team existed, defunct), so nothing
  was copied across.
- **D1 is a dependency of every team call**, as the object was. A Worker with no database says team
  spaces are not available (503); with the database down a team call fails, and devices carry on
  from their own copy (offline first). Nothing about a team is best effort now: the audit trail
  is written in the same batch as the change it records.
- **Setting it up.** `wrangler.toml` has a `[[d1_databases]]` binding `DB` with no `database_id`:
  wrangler makes the database, named `chordless-teams`, on the first deploy, and the deploy then
  applies `migrations/`. The Cloudflare token the deploy uses needs **D1: Edit**. In development
  it is a local database; `just db-local` makes its tables. Tests run the migration files against
  SQLite (`tests/d1-db.ts`; in the browser, through Web Test Runner, `tests/d1-browser.ts`).
- **Asking it.** There is no route that reads the register: the operator asks with wrangler, for
  example `npx wrangler d1 execute chordless-teams --remote --command "SELECT name, owner_email FROM teams WHERE ccli_licence = '471102'"`,
  or how many people a team has: `SELECT t.name, COUNT(m.identity) + 1 AS people FROM teams t LEFT JOIN team_members m USING (space_id) WHERE t.ended_at IS NULL GROUP BY t.space_id`,
  or the teams a person is in: `SELECT t.name FROM team_members m JOIN teams t USING (space_id) WHERE m.email = 'x@example.com'`.
- **Not covered.** A team's renaming is not noted (a team cannot be renamed yet).

The CCLI licence number and SongSelect's terms are in [CCLI.md](CCLI.md).

## Naming

- The umbrella word is **space**, and there are two kinds: a **personal space** (yours alone, in
  your own Drive) and a **team space** (shared, through the Worker). "Create a team space", "Join a team
  space", "Save to: Personal space / Grace Church (team space)". The old word "organisation" went from
  the UI, the code and the docs on 2026-10-20. It survives only where old data may still carry it, and is moved
  when the app loads: the IndexedDB database `organisations` (and its store) is copied to `spaces` and
  removed by `SpaceDB.init`, the `localStorage` keys `current-organisation-*` become `current-space-*`
  (`space.ts`), and the `appProperties` of files already in Drive (`organisationId`, read by nothing)
  lose it at their next update.
- **In the UI, "space" is kept out of titles and labels** (decided 2026-10-22: too generic for a menu title; the one place it is used is the list's section heading, "Personal and Team Spaces"). People see
  **Personal** and **Team**: a card shows the space's name with a label beside it, Personal or Team
  (none on a personal space still called "Personal"), and the person's role in a Team; the button is "Create a new Team" and the page that lists them is "Account
  and Teams" (`docs/ACCOUNT.md`). Roles read owner, admin, worship leader (the `writer` role) and
  team member (the `reader` role). The code, the routes of the API and these docs keep "space".
- Each space also has its own name (a team space is named by its owner; the personal space defaults
  to the account name, as `first-time-auth.ts` does today). The kind shows as a small label beside
  the name, and only when the user has more than one space.
- Not "Personal Library": the Library page (`/songs`) is the song list and every space has its own,
  so keep "Library" for the page only.

## The model

A space is made for a team: there is no button that makes an empty one. The personal space is made
automatically, and a team space comes with its folder, its sharing and its members, made together
by the wizard (see "Creating a team space", below). The Account and Teams page therefore lists the
spaces on this device (a card each, with Switch, Sync and Data) and has no "Create New Space"; the
tabs under the header (below) switch too.

**A personal space is never turned into a team space** (decided 2026-10-22). The first cut had a
"Share this space" button that registered the current space's folder with the Worker. It was
confusing: the team space kept the personal space's name (the owner's) and folder (`Chordless/`), and
nothing said that what had been private was now shared. A team space is always a new space, in a
folder of its own; the wizard brings the personal data across if the owner asks. Spaces already
shared that way keep working and can be renamed.

A space is a local IndexedDB plus a Drive folder; what changes between the kinds is who owns the
folder and how data reaches Drive.

| | Personal space | Team space |
|---|---|---|
| Drive folder | `Chordless/` in your My Drive, as now. No picker. | **Chosen by the owner** with the Picker: any folder in My Drive or a shared drive. No hard-coded path. |
| Identity | the folder named `Chordless` | server-issued space id; folder found by stored `rootRef`, never by name |
| Drive access | direct, your `drive.file` token | owner: direct. Members: via a Worker route using the owner's token |
| Roles | you | owner / admin / writer / reader, enforced by the Worker |
| Pads | `<space folder>/pads/` | `<team folder>/pads/` |

**Folder choice.** On create, the owner picks a *parent* folder; the app then creates `<team name> Chordless/`
(so it is told apart in Drive from the personal `Chordless` and from other folders; the space's own name is
just `<team name>`; folders made earlier keep their names, and a rename in Drive is safe as the folder is found by `rootRef`)
inside it (`songs/`, `setlists/`, `shares/`, `pads/`). Because the app creates the team folder,
`drive.file` grants it everything inside. A Picker-picked folder alone exposes no children (the
2026-10-13 finding), so the picked folder must not be the team folder itself. The picker copy
recommends a **shared drive** (members can see the files in Drive, the files survive the owner
leaving, Google backs them up) but a My Drive folder is fine. Shared drives need `supportsAllDrives`
and `includeItemsFromAllDrives` on every Drive call (built: `allDrivesUrl`, `drive-client.ts`) and the Picker API
(`folder-picker.ts`: the key is `PICKER_API_KEY` on the Worker, served at `/api/config`; app id `818185619377`, the
`chordless-app` project number; the CSP allows `apis.google.com`, `docs.google.com`, `www.gstatic.com`).

**A team space with only its owner needs no Worker** and syncs like a personal space. "Enable
sharing" is the opt-in that hands the Worker the owner's token. One owner per team space (a person
or a shared church account). Multiple live owners aren't viable under `drive.file`: each token sees
only its own files. Files made by the owner's token are invisible to a *new* owner's token even
inside a shared drive, so succession is a copy from a member's local data (see "Copy and move"), not
a re-pointing of the folder.

## Today (built)

### Storage

- Global IndexedDB database of space metadata (id, name, timestamps), used to list spaces and
  rename them. Each space has its own IndexedDB database named exactly by its id, with the stores
  described in DATA_MODEL.md. The name never changes, even when the space is renamed (a rename
  updates only the metadata, the cached name in localStorage and, at the next sync, the Drive
  folder).
- localStorage caches the current space's id (`current-space-id`) and name
  (`current-space-name`) for synchronous rendering.
- On first load a default space named "Personal" is created and made current. On a first Google
  sign-in, a space still called "Personal" is renamed to the user's name (metadata only).
- **Deleting a space:** from this device only, or everywhere (the Drive folder to the trash):
  see "Deleting a space", below.
- Spaces are completely isolated: songs and setlists belong to exactly one; switching (a tab, or
  Switch on a space's card) shows the home page afresh on the other database (no page reload:
  `switchSpace` in `space.ts` sets the current space, tells `SpaceChangeEvent`, and goes to `/` with
  `{ fresh: true }`); a setlist references only its own space's songs; the same CCLI song in
  two spaces is two separate instances. The library alone can list other spaces' songs
  (`other-songs.ts`, "Add to my library").

### Finding the Drive folder

- The first sync on a device finds the folder **by name** (so a new device joins an existing
  space) and stores its id on the space record (`rootRef`). Later syncs use the id, so a
  rename can't point sync at a different folder.
- After a rename, sync renames the Drive folder to match, unless another folder has that name; if
  the device has nothing synced yet, it joins that existing folder instead.
- If the linked folder is trashed or gone, sync stops with an explanation rather than creating a
  new one.
- A team space never finds its folder by name (the id is issued and stored); a personal space does
  on the first sync of a new device.

### Setlist leaders

A setlist's leader is `leaderId`, a person of the space (`docs/IDENTITIES.md`). The Leader dropdown
lists the space's people: the folder's members (cached at sync, from Drive permissions) and the
signed-in user each have one made for them, who is the default for new setlists, and "Other…" makes
another. With the team service, the member list comes from the Worker instead.

### Sign-in model

The Worker keeps no per-user state (a team's members are the team's, in D1).

- **Signing in:** Google sign-in (GSI) runs in a popup, and the page posts the code and ID token to
  `/oauth/callback`. The Worker verifies the ID token, exchanges the code for tokens, encrypts the
  refresh token into a JWE blob (AES-256-GCM, with a `kid` for key rotation) and returns the blob,
  an access token and the user's profile.
- **The blob** is stored by the service worker in the `auth` IndexedDB. Pages get access tokens by
  messaging it.
- **Expired access tokens:** the service worker refreshes them with `/session/refresh`. The Worker
  decrypts the blob only for that request.
- **Expired sign-in:** when Google answers `invalid_grant` to a refresh (the refresh token expired
  or was revoked; it dies after 7 days if it was made while the consent screen was "Testing"), the Worker answers
  `401 invalid_grant` and the client throws `SignInExpiredError`. A blob the Worker cannot decrypt
  (made with a key it no longer has) is the same to the person: `401 invalid_blob`, also
  `SignInExpiredError`. `getSignInState()` is
  `signed-out`, `signed-in` or `expired`; only those refusals make it `expired` (no network, or
  any other failure, counts as signed in). The Account and Teams page then says "Sign-in expired", offers
  "Reconnect with Google", and disables the sync panel with the reason. The sync that runs by itself
  (`auto-sync.ts`) stops too, which would otherwise be silent: it shows one error toast with a
  Reconnect button (a popup, so nothing reloads), once until a sync can run again. Edits made here
  stay on the device and are sent after reconnecting.
- **Scope:** `drive.file openid email profile`. Drive access is limited to files the app created
  (or the user picked with the Picker).
- **Who is asking the team service (built 2026-10-21):** Google's own ID token, as
  `Authorization: Bearer`. Google sends a new one (an hour, checked on a real refresh) with every
  refreshed access token, so `/session/refresh` passes it on and the page keeps it beside the access
  token. `getIdentityToken()` (`google-auth.ts`) renews it silently (the old One Tap
  prompt, `getIdToken`, has been removed). The Worker side is `worker/src/identity.ts`: an
  `IdentityProvider` says which issuers it answers for and verifies a token (signature, issuer,
  audience, expiry, and a *verified* email), and `authenticate(request, providers)` matches the token
  to its provider by issuer. Google is the only provider. It gives an `Identity`
  `{provider, sub, email}`: members are keyed by `provider:sub` (`identityKey`), since a `sub` is
  unique only within a provider. It says who someone is, not what they may do: roles are the
  space's. There is no Worker signing key.
- **Signing in without Drive (checked and built 2026-10-21):** asking for `openid email profile`
  alone gives a refresh token, an ID token with a verified email, and an access token, and asking
  later for `drive.file` alone (with `include_granted_scopes` and `prompt: consent`) adds the Drive
  scope to the earlier ones, with a refresh token. Google's window showed no box to untick for
  either request, so "Connect Google Drive" as its own request cannot be passed with Drive unticked,
  unlike the combined request made by "Connect with Google" (`drive.file openid email profile`),
  which has a box. `/oauth/callback` no longer refuses a sign-in without `drive.file`; it returns
  `scope` (what was granted), which the page keeps. `authorizeWithGoogle({drive: false})` signs in
  for who someone is alone (what a team member joining needs), `connectDrive()` adds Drive, and
  `getSignInState()` says `'no-drive'` while the stored sign-in has no Drive scope (one made
  before the scope was kept is taken to have it). The Account and Teams page then says "Signed in, Google Drive
  not connected" with a **Connect Google Drive** button, and the sync section points at it; syncing
  is off (`driveStorage.available()` is false) and local use and team spaces are unaffected. Not
  checked: whether the refresh token is sent again without `prompt: consent` (connecting forces it).
  The space's own page says the same for a personal space (built 2026-10-22). Not built: a toast after sign-in; the Account page already says it inline, and the sign-ins that end without Drive elsewhere (joining a team) are meant to.

### The three credentials, and how they are used

| Credential | Held by | Proves | Used with |
|---|---|---|---|
| Refresh token | Inside the encrypted blob. The page keeps the blob but cannot read it; only the Worker can | "This person authorised Chordless to use their Drive" | Only the Worker, to get access tokens |
| Google access token | The page (an hour) | Drive permission for that person | Google Drive directly (personal spaces) |
| Google ID token | The page (an hour) | "This is `a@example.com`" | The Worker's `/api/space/...` calls |

1. **Sign-in, once** (built):
   ```
   page ──popup──► Google ──code──► /oauth/callback (Worker)
                                      │ exchanges the code, checks the ID token
   page ◄── access token, blob, ID token ──┘
   ```
2. **About every hour** (built):
   ```
   page ── blob ──► /session/refresh (Worker)
                      │ opens the blob, asks Google for a new access token
   page ◄── new access token + new ID token
   ```
3. **A personal space syncs** (as always): `page ── access token ──► Google Drive`. The Worker is
   not involved.
4. **A team member syncs** (built end to end, for an owner-token space):
   ```
   page ── ID token ──► Worker /api/space/<id>/read-many
                               1. verify the ID token: who is this?
                               2. ask the space (D1): what role?
                               3. refuse, or carry on
                               4. use the space's Drive credential ──► Drive
   page ◄── the files ─────────┘
   ```
   The member's own Drive access plays no part, and the member needs none. The Worker uses the
   space's credential (the owner's token from the owner's blob in D1, later the
   service account), so Drive sees one account acting for the whole team.
5. **The space's owner syncs** directly, as in 3: they own the folder.

The ID token is for the Worker's access control only: it says who is asking, the space's rows in D1
say what they may do, and the Drive credential does the reading and writing.

## Why the Worker serves members (verified 2026-10-13, real second account)

Under `drive.file`, sharing a space's Drive folder with another person does not give them access:
they cannot find it by name, and picking the folder in the Picker gives them the folder and
**nothing inside it** (it listed 0 items though it has `songs/` and `setlists/`). The folder's
`capabilities` do show a reader correctly, but a second person cannot sync from a folder someone
else made. Access is per user and per file (shared drives not tested; expected the same).

**Ruled out:**
- A folder-scoped token: Google has none (`drive.file` is per file; then `drive.readonly` and
  `drive`, whole Drive, restricted).
- The restricted scopes: they need verification, and an app whose server holds refresh tokens needs
  an annual third-party security assessment. An unverified app is capped at 100 users over the
  project's lifetime. "Internal" to a Workspace domain avoids this, but only that domain could sign
  in and most volunteers aren't on it.
- Picking each file: breaks when the owner adds a song.
- A service account with a folder shared into a *personal* Drive: reads work, but service accounts
  have no storage quota, so writes typically fail (a shared drive is different: see Credentials).

**The design:** the Worker acts with the owner's access on members' behalf.
1. The owner presses "Enable sharing". The Worker keeps the owner's token (the encrypted blob it
   already issues) in the team space's rows in D1, with its member list and a role for each.
2. A member signs in with the ordinary `drive.file` scope (no warning screen). Their app sends its
   Drive calls to `/api/space/<id>/drive/...` with their Google ID token. The Worker checks the
   member list and forwards the call with the **owner's** token, which covers every file the
   owner's app created.
3. The Worker enforces the role and keeps calls inside the team folder's tree, so roles are enforced
   on the server and nobody needs the Drive folder shared with them. The client change is small:
   `drive-api.ts` already has `setAccessTokenProvider`.

Costs and risks: the Worker carries the traffic; D1 holds a token that reaches
everything the owner's app made; if the owner revokes the app or the token expires, sync stops for
everyone (the consent screen must be "In production": refresh tokens last 7 days in "Testing").

## Creating a team space (the wizard)

**Decided 2026-10-22, built except where marked.** The adoption path is: someone at a church tries Chordless on
their own, in the personal space, then decides the team should use it. Making that step easy is
the job of one dedicated page (a route, `/account/new`, not a modal on the Account and Teams page: it has
several steps, and a route gives it the back button, reload and a URL, see ROUTING.md). It is
reached from the "Create a new Team" link under the Teams on the Account and Teams page, and offered to
someone who has used their personal space for a while.

Steps, each on the one page:

1. **Name.** The team's name, supplied by the creator ("St Mary's Music"). It is the new space's
   name and its folder's name. Never taken from the personal space.
2. **Where the files live.** Two choices, as "Credentials" describes:
   - *The team has a Google shared drive*: recommended (the files outlive any one person, members can
     see them in Drive, Google backs them up). This is also the way in to the **service account**
     ("Team-managed storage"): the wizard shows the address to add as Content manager, "Verify"s it,
     and the owner's token is never stored. **Not in the wizard:** it has one folder choice
     ("Where to keep it in Google Drive", with a hint that a shared drive is best) and starts every
     team on the owner's token. The switch is made afterwards from "Team storage" on the Team's
     page (`team-storage-panel.ts`, "Credentials" below).
   - *No shared drive*: pick a parent folder in My Drive with the Picker. The owner-token path, and
     the default for free Gmail users. Shared drives need Workspace, so this cannot be dropped.
   Either way the app creates `<name>/` inside the picked parent (with `songs/`, `setlists/`,
   `shares/`, `pads/`): a picked folder alone exposes no children under `drive.file`.
3. **What to bring** from a space on this device (the one in use if it holds anything, else the
   first that does; a dropdown if more than one does), as separate checkboxes, each with its count
   and size ("Songs (212, 640 KB), copied"). Built 2026-10-22, except pads.
   - **Songs are always copied, never moved**: a song deleted from a synced library would come back
     (SYNC_ARCHITECTURE.md), so the source keeps its songs. Ticking only the setlists still brings the
     songs they use.
   - **Setlists: move** (default) or **keep a copy**. An upgrade means the team's setlists should
     leave the personal space, so move is the default and the wording says so ("they leave your
     personal space"). Moving asks for a confirmation that names how many setlists will go. A
     setlist already saved to Drive is removed from the source too: its file goes to the Drive trash at
     the source's next sync ("Deleting setlists", built 2026-11-12).
   - They go through `space-transfer.ts` (`contentsOf` counts, `bringAcross` does it; the local
     databases, no Drive access to the source needed). A copy gives setlists new ids, a move keeps
     them (as "Copy and move" says), so this is that code and not the export file's import.
   - The space is made first. If bringing things across then fails, the result page says why and
     offers "Try again" (it is re-runnable: what is there is skipped).
   - **Pads are not in this step yet.** Every space has pads of its own (item 6), but bringing
     another space's across needs Drive calls. When it does, the checkbox is hidden if there are none.
4. **Invite people** (built 2026-10-22; `team-invite-step.ts`, on the result page once the space
   exists, since an invite needs its id). The setlists brought across have leaders (people,
   with emails). Leaders with an email are listed once each (`leadersOf`), ticked, with a
   role to choose (writer by default), and an email can be added by hand; the person making the
   space is left out. Nothing is sent without being ticked, and Chordless sends nothing itself:
   each invite is a link, shown once, to copy and pass on. A leader typed by name alone has no
   email and is listed as someone who cannot be invited. A refused invite stays in the list to try
   again. Invites are the existing ones (single use, bound to the email, a week).
   Each link has a "Send…" button next to "Copy the link" (`invite-send.ts`, 2026-11-11, also in the
   Team Space panel): the share sheet where the browser has one, else WhatsApp and Gmail's compose
   window to that address. The message comes from the user's own account.
5. **Progress and result.** The space is made and registered with the Worker *first*, so a failure
   later never loses it. The transfer then runs, and is re-runnable (what is there is skipped), so
   the failure screen offers "Try again". The result says what was added, skipped and removed from
   the source, and ends with the switch to the new space.

A team space's creator is its owner. The personal space is left as the place for private sets.

## Credentials: two ways to back a team space

A human's OAuth token can't be given a wider-but-safe scope: anything beyond `drive.file` is
restricted. So the upgrade is not a better token from a person. It is a **service account**, an
identity of its own, not subject to app verification, seeing only what is shared with it.

| | Owner-token (default) | Team-managed (service account) |
|---|---|---|
| Works for | any Google account, My Drive or shared drive | **shared drives only**, so Workspace (check the nonprofit tier includes them) |
| Credential in D1 | the owner's encrypted refresh token | none per team: the team shares its drive with Chordless's service-account address; the key is a Worker secret |
| Single owner? | yes; owner leaving or revoking stops sync; succession by copy | **no**: the files belong to the shared drive; any number of Chordless admins |
| Blast radius | one person's `drive.file` files | whatever each team shared with the account; a Worker bug could touch every team that did |
| Setup | automatic | "Add `<address>` as Content manager of your shared drive" → "Verify" |

**Why shared drives only:** a service account has no storage quota, so it can't create files in
someone's My Drive folder, but files it creates in a shared drive belong to the drive. That is also
what makes ownership disappear as a problem.

**Built 2026-11-10, tested on fakes, and tried 2026-11-12 with two real teams on the service account** (the token request signed with a test key and checked at a
stand-in for Google's endpoint, the folder check on FakeDrive, the routes end to end through the
router): `worker/src/service-account.ts` makes the account's tokens (RS256, signed with `jose`, kept in
the isolate's memory for their hour) from the Worker secret `TEAM_STORAGE_KEY`; the space's row in D1
records which credential it uses (`credential`: `owner` or `service-account`); the owner's
page has "Team storage" beside the Team's people (`team-storage-panel.ts`). Routes:
`GET /credential` (admin: which, and the address), `POST /credential/service-account` (owner: check,
then switch), and the existing `PUT /credential` with a sign-in, which switches back. The key is made by hand
(`gcloud iam service-accounts keys create` for `team-storage@chordless-app.iam.gserviceaccount.com`,
then `wrangler secret put TEAM_STORAGE_KEY`); without it the panel shows nothing, and nothing
changes. **Not built:** step 1 below (moving the folder into a shared drive): the check says so when
the folder is in a My Drive. Unchecked on a real drive: that Drive's feed of changes, asked by the
service account, covers a shared drive's files (`includeItemsFromAllDrives` is sent).

**Upgrade flow (team space settings → "Team-managed storage"):**
1. Choose or create the shared drive and move the team folder there if it isn't (the copy/move tool).
2. Show the service-account address and the exact role to grant: Content manager. Contributor can't
   trash, so pad rules would be Worker-only. Content manager **can trash but not permanently delete**
   (only a Manager can; checked 2026-10-19 with a Content manager's token: `canTrash` true,
   `canDelete` false, and a permanent delete answers "File not found"), which is why the app only
   ever trashes.
3. "Check and switch" makes the Worker test, with the service account, that it sees the folder, that
   the folder is in a shared drive (`driveId`) it can add to and trash in, and that it can make a
   file there, read it back and put it in the bin. Each failure says what to do.
4. The Worker switches that team space's transport to the service account and **deletes the owner's
   stored token blob** (which also removes the broad personal token from D1).
5. Rollback by re-adding an owner token. Members' experience doesn't change.

**Restrictions:** the account can only reach what was shared; recommend a dedicated shared drive for
Chordless (a shared drive's membership is drive-wide, not per folder, so "least privilege" means "a
drive of its own"). The Worker also checks every call's target is inside the team's `rootRef`
tree (the owner-token path needs the same check).

**Operator choice, recommended: one Chordless-operated service account** (key in a Worker secret,
never in KV/DO, rotatable) so teams just share a drive and paste nothing. The credential provider is
looked up **per team** (`credentialFor(teamId)`), so one account per team can follow without
redesign. Not now: per-team accounts need Chordless to hold a key-minting credential (IAM Service
Account/Key Admin) and many keys in Durable Objects under one master secret, so a Worker compromise
still reaches them all; they'd mainly help against a single leaked key, per-team revocation, audit
clarity and per-identity rate limits (Google's 100-accounts-per-project default is a further limit).
The service account is `team-storage@chordless-app.iam.gserviceaccount.com` (made by Terraform in
`infra/google-chordless/`, 2026-10-20): the address a team admin sees in their shared drive's
members is `<name>@<project-id>.iam.gserviceaccount.com`, and a project id cannot be renamed, so the
account has a tidy project id. It is in the app's
own project, the one that holds the OAuth client and the verified brand, for the time being;
ideally the key that can reach every connected team's drive sits apart from the sign-in project, in
a project of its own (decided 2026-11-10 not to, for now). Revisit with many teams or if the spike
shows rate limits bite. Also not built: bring-your-own
service account (the team uploads its own key; isolation, but real setup friction for a church).

Roles, pads and conflicts are identical in both modes (the Worker enforces them either way); only
the credential provider behind the transport differs. Build the owner-token path first and slot the
service account in as a second provider.

## Setting up and joining a team space: decisions so far (2026-10-20)

Agreed with the owner of the project:
- **Google accounts only**, for members as well as owners. Anyone can make a Google account on
  their existing email address (accounts.google.com/signup, "use your existing email"), so the only
  blocker is someone who will not use Google at all; that is accepted. Share links (read-only, no
  account) cover the rest. A second identity provider (emailed link) is possible later: the team service
  takes an identity provider's ID token through `IdentityProvider` and keys members by provider and
  `sub`, so another provider is another `IdentityProvider`.
- **A member signs in as everyone does** (`initCodeClient` popup). The Worker verifies the ID token
  and the page then sends Google's ID token to the team service, renewed in `/session/refresh`. A member needs only
  `openid email profile`: all their Drive traffic for the team space goes through the Worker, so
  an unticked Drive box affects only their personal space.
- **Pad sets** of a team space are in its folder, and the Worker streams them to members ("Pads in
  team spaces", below).

Built 2026-10-21 (`worker/src/team-admin.ts`, routes at its top):
- **Making a space:** `POST /api/spaces` with the page's blob, the folder and a name. The Worker
  checks the blob is the caller's (`owner_sub` against the ID token) and that it sees the folder,
  writable and not in the bin, then issues the space's id and keeps the blob in D1
  (`team_credentials`). The owner's client keeps the id (nothing records a folder against an id on the Worker, so
  sharing the same folder twice makes two spaces).
- **Invites are for an email address.** An admin makes one for a role and an email
  (`POST /invites`) and gets its code once. Only the code's hash is kept; it lasts a week, is used
  up once, and can be used only by an account whose email Google verified as the invited one
  (`POST /api/spaces/join`): anyone else with the code is told it was sent to a different Google
  account, and the code stays good for the right person. The member is then recorded by
  `provider:sub`, not by email, so a later change of address does not matter. Unknown, used and
  expired codes all get the same answer. Someone already in the space keeps their role and uses
  nothing. The cost of binding it: a person who signs in with another address than the one invited
  is turned away, and the admin has to invite the address that appears in their Google account (a
  Gmail address with dots or a `+tag` is a different address from the plain one). The link to hand
  out is the page's, with the space id and code in its fragment (built), and is handed on from the
  admin's own account by the share sheet, WhatsApp or Gmail (`invite-send.ts`).
  The message says how to make a Google account with an address that is not Gmail's (a link to
  Google's sign-up and "Use my existing email address"; `googleAccountHelp`). Whether an address is
  a Google account cannot be known (a Workspace domain or an address made a Google account looks like
  any other, and probing Google's sign-in is not something Chordless does), so only `gmail.com` and
  `googlemail.com` leave the text out, and nothing is ever refused for it. The invite carries no name:
  on joining, the person named by the address alone (a placeholder) is renamed to the Google account's
  name by `getSpacePeople`; a name someone gave is kept.
- **Chordless does not email invites itself** (decided 2026-11-11). It would make chordless.app a
  sender anyone with a team could point at any address (spam and phishing under the domain, which
  would also hurt Email Routing), and mail from a new domain lands in spam, so "I never got it" would
  be a support problem. Revisit only if links are shown to get lost; then it needs per-account and
  per-space rate limits first (the probing protections list).
- **Looking after people:** a role acts only on those below it (an admin on writers and readers,
  the owner on admins too; nobody on the owner), so an admin cannot make or remove an admin. A
  member can leave; the owner ends sharing instead (`DELETE`), which forgets the space; the owner can
  replace the stored sign-in (`PUT /credential`) when Google no longer honours it.

Proposed, not yet confirmed:
- **Ask first whether the team has a Google shared drive.** If so, go straight to the service
  account (the owner's token is never stored; the Worker can make the team folder itself once the
  service account is a member of the drive, so the Picker is not needed for that path). If not,
  the owner-token path, with a My Drive parent picked with the Picker. Owner-token stays the
  default for free Gmail users.
- **Still to check on a deployed Worker:** request-size limits for pad uploads, whether an external
  service account can be added to a shared drive under a stricter sharing policy, and whether the
  nonprofit tier has shared drives.

The Worker serves the storage API (docs/STORAGE_API.md) to members.

## Roles

owner (implicitly admin) > admin > writer > reader. Worker enforcement:
- **Read** songs/setlists/pads: all members.
- **Write** songs/setlists: writer and up.
- **Name yourself: any member**, readers included (built 2026-10-30): the name of the person whose
  addresses include the member's verified email, by one route that changes nothing else
  (`PUT /people/<id>/name`; docs/IDENTITIES.md, "Who may edit people"). Every other change to the
  space's people is a write: writer and up.
- **Upload pads: any member**, readers included (create-only, `pads/` folder only).
- **Delete pads: admin and up.**
- **Delete setlists** (decided 2026-10-22): a **writer may delete a setlist they lead** (its
  the person who leads it has their verified email among their addresses: docs/IDENTITIES.md); **only an admin (or the owner) may delete one someone else
  leads.** A reader never.
- **Delete songs: admin and up** (decided 2026-11-12). It is for a bad import or a mistake, and it
  takes the song out of every setlist that has it (`deleteOnlyVersion`). A worship leader can still
  delete one *version* of a song that has several (setlists using it fall back to the default), and
  replace a chart on import. The page shows "Only an admin can delete a song." in place of the
  button (`mayDeleteSong`); the Worker does not check it, because replacing a version bins a chart
  file in the same call.
- **In a personal space the person is implicitly an admin** and may delete anything: they are a
  grown-up, and the backup (export) feature is there. **Every delete asks for confirmation, in every
  case**, danger-styled, naming the effect (CLAUDE.md: friction, not prohibition).
- How a deletion works is in SYNC_ARCHITECTURE.md, "Deleting setlists". **What the Worker enforces
  today:** a reader changes no file (`write()` in `team-api.ts` needs a writer), pad rules are
  enforced, and so are the admin routes (people, invites, credential, licence, deleting the space).
  **The setlist rule is enforced too** (`worker/src/team-leaders.ts`): `POST /files/<ref>/trash` on a
  setlist's file is refused (403) to a writer unless the setlist's leader (`leaderId`, followed
  through a merged person; an older setlist's `ownerId` email) has the writer's verified email among
  their addresses. The Worker reads the setlist and the person's file through to decide and keeps
  nothing; a setlist with no findable leader is for an admin. **The song rule is the page's alone**
  (`mayDeleteSong`, above): a writer's token can still bin a song's file. Until restrictions on editing others' setlists exist
  (SYNC_ARCHITECTURE.md), a writer can make themselves the leader first, so the rule guards against
  mistakes, not a determined writer.
- Invite, remove, change roles, enable/disable sharing: admin and up (owner for disable/transfer).

Undecided: whether writers may edit others' setlists (see "Several people editing a setlist" in
SYNC_ARCHITECTURE.md), and an admin's finer powers.

## Pads in team spaces

Built 2026-11-10, tested on fakes (the memory storage, FakeDrive, the Worker's router end to end in
`team-contract.test.ts`); no real run of the pad routes is recorded here.

- **Where they are.** Every space's pads are in its own folder, `<space folder>/pads/<set>/`, a
  personal space's as well as a team's (`backend.padsIn(rootRef)`: STORAGE_API.md, "Pad sets"). There
  were once pads that belonged to the account, in `Chordless/pads/`, shared by every personal space
  (changed 2026-11-11, nothing migrated: a set uploaded before must be uploaded again). That folder was
  found by the name `Chordless`, which can be a folder that holds other spaces' folders, and listing the
  pads made it when it was missing: it came back after being deleted. A space not in Drive yet has no
  folder, so no pads; and reading a space's sets makes no `pads/` folder, only an upload does.
- **Reaching them.** The owner straight in Drive; a member through the Worker
  (`/api/space/<id>/pads…`, `worker/src/team-pads.ts`), which streams a file's audio out as Drive
  sends it, with `Cache-Control: no-store`, and keeps nothing. An upload is one MP3 per key, up to
  20 MB, held in the Worker's memory while it is sent on to Drive (never stored). A set or file is
  reached only once the space's tree holds it (a listing notes it, as for charts), so a ref from
  another space is a 404. Body-size limits on a deployed
  Worker are still unchecked (a pad is a few MB, well under them).
- **Roles.** Any member reads and uploads, readers too. Below an admin an upload only **adds**: a set
  of a name that is there, or a key the set already has, is refused (409, "give yours another
  name"), so a team member cannot wipe the team's pads by mistake (decided 2026-11-10). An admin (or
  the owner) replaces a set as before: its files go to the bin, and it is filled again. A key the set
  lacks can be added by anyone, so an upload that stopped half way can be finished.
- **The picker** lists the sets of every space on the device at once. With the sets of more than one
  space they are grouped under the space's name, the personal spaces first; with one, there are no
  headings. **The choice is per device**, as before: each musician
  picks their own sound (decided 2026-11-10; a team default a leader sets is in the TODO). The
  choice keeps its space (`spaceId` on the stored set), and the audio kept offline is by Drive file
  id, unique across spaces, so what devices had kept still serves.
- **The upload form** has "Save to" (each space on the device that is in Drive), starting at the
  space the app is in; it is not shown with only one.
- **Export and import** take the space's own pads.
- Not built: bringing pads across in the wizard, and copying or moving them between spaces
  (copy/move, above). A signed, short-lived direct download is *not* possible under `drive.file`,
  which is why the audio goes through the Worker.

## Presenting spaces

**As built.** The tabs under the header (next section) are how a person sees a space's setlists,
library and Add Song page, and the Account and Teams page has the data and sync of each. One space
is in use at a time ("current"), and a tab is the switch. There is no "Merged / Separate"
preference and no switcher in the header, and none is planned (decided 2026-11-12: the tabs do the
job). Three things are shared across spaces:
- **The library** lists other spaces' songs too (`other-songs.ts`), with a filter bar
  (`library-space-filter.ts`, shown with two or more places) to switch a space's songs off; what is
  left out is kept in this browser (`library-spaces.ts`).
- **Pads:** the picker lists the sets of every space ("Pads in team spaces").
- **Hidden entirely with one space** (the common case): no tabs, no labels, no choice.

A setlist belongs to exactly one space and references only that space's songs.

**Creating a setlist** is in the current space. The form says which ("New setlist in Grace Church",
plus the kind label when you have more than one space). A wrong choice is fixed with "Move to this
space" in the setlist's info dialog, in edit mode (keeps the setlist id: SYNC_ARCHITECTURE.md,
"Deleting setlists").

**A default space (proposed 2026-11-12, not built, to be confirmed).** One space on a device is
marked "default" ("Set as default", on a space's card and in a tab's menu):
- it is the leftmost tab, the others keeping their fixed order;
- it is where new things go: the "Save to" of the upload form, Add Song, imports and a new setlist
  are pre-filled with it (a pre-fill, never a lock). If the default is one the person cannot write
  to, the next space they can write to is used and the form says so;
- with no choice made it is the first team joined or made, else Personal; leaving or deleting it
  falls back the same way;
- kept per device, in this browser; it does not decide which tab the app opens on (to be
  confirmed: the last tab used is the better start in a service).

## Space tabs, and joining by invite (decided and built 2026-10-23)

The reason: someone tries Chordless alone, then their church makes a team and invites them. Their
songs and setlists must not seem to vanish, and someone whose first contact is an invite should
never meet a "Personal" space they did not ask for.

**Tabs under the header** of the Setlists, Library and Add Song pages, replacing the title-only
"Setlists - Gateway Church" as the way to see and change space.

- One tab per place: each Team (by its own name), Personal (by the person's name once signed in),
  and **Shared** (the `shared-with-me` database, `docs/SHARING.md`). A small Team/Personal label sits
  beside the name, so two teams are never both "Team".
- **Only tabs that exist.** One place means no tab bar; Shared
  appears only when something was shared; a Personal space with nothing in it (and not the current
  one) has no tab. It returns as soon as something is saved there, and the Account and Teams page can
  always show it.
- Fixed order (Teams, Personal, Shared), the current tab marked. About three or four fit a phone;
  beyond that the rest go under a "More" menu, the most recently used staying as tabs.
- A tab is the space switch (the home page, made afresh: no reload). Reading another space's
  database without switching the app is done only by the library (above).
- A `role="tablist"` under the header, with arrow keys (as `chart-diff` does), never in the header,
  so it stays clear of the live-setlist controls. Account and Teams stays for managing spaces
  (create, leave, delete, sync), and its cards can switch too.
- "Shared" is a tab of its own, not only a group at the foot of the home page.

**Joining by invite**
- Accepting an invite makes the team the current space and the first tab.
- **Nothing is offered from a personal space** (decided 2026-11-11). It used to ask once, after the
  first sync, "You have 14 songs and 3 setlists in Personal. Bring them into Gateway Church?" with
  "Bring them in" as the main button. One press moved a whole personal library into a team (a second
  browser, joining a new events team, put 92 church setlists into it). A move cannot yet remove what
  is in Drive from the personal space, so it came back with the next team joined. Joining adds nothing
  but the team's own files. The wizard's "What to bring" step, on making a team, stays: it is a
  deliberate choice, with counts. Moving one setlist to another space is a separate action on the
  setlist (docs/SYNC_ARCHITECTURE.md, "Deleting setlists").
- **No Personal space for someone whose first contact is an invite.** It is created lazily
  (`ensureCurrentSpace`, `getCurrentSpaceFull` in `space.ts`, only when no current space is set). The
  launch path sees an invite link before any space exists, signs in and joins, so the team is
  current and Personal is never made. If the join fails (sign-in cancelled, expired code), fall back
  to creating Personal, so there is always a space. Personal is made later if wanted (saving a song
  with nowhere else, choosing it in a picker).
- Check first what else assumes a Personal space: the sign-in rename of "Personal" to the Google
  name, the repair page, the export.
- The Import page's "Import into" picker follows the same tabs: a space that is hidden is not
  offered unless it is the only one.

**Teams on another device** (built 2026-11-12; `team-memberships.ts`, `GET /api/spaces`)
- A team space is on a device because that device joined it, so a second device, or a new browser,
  signed in as the same person had none of their teams. The Worker knows who is in what (D1:
  `teams` and `team_members`), so a device **asks**: `GET /api/spaces` lists the still-shared spaces
  the signed-in account is in, each with its name and the person's role; an owner's entry also has
  the folder's Drive id (`rootRef`), as an owner's device reaches the folder straight, while a
  member's goes through the Worker and needs nothing but the space's id. It reveals only the
  caller's own membership. Nothing new is tracked on the Worker.
- The device **makes the spaces it lacks**, as joining makes them (named as the team calls it,
  "(team)" added if the name is taken; a team member's is read only), does their first sync, and
  tells the person in a toast ("Added the team St Mark's"). A team it already has is not made twice
  (matched by the team's id), and a known team's role is brought up to date (an owner's never changes).
  If the device has no space in use, the first one made is. Anything that cannot be reached (not
  signed in, offline) leaves the device as it was, and the next check tries again.
- **When:** at start-up, after a sign-in, and when the app comes back to the screen (at most every
  fifteen minutes), and by hand: Account and Teams has **Look for my teams** when signed in. Joining,
  making a team and this check take one Web Lock (`chordless-team-spaces`), so a space half made by a
  join is not made again by a check.
- **First sync starts at once** (`syncTeamSpace`, as joining does), one team after another. Until it
  ends, the team's home page does not show the welcome card: that is a new user's, and a team is not
  new because it has nothing here yet. `emptySpaceKind` (`empty-space-kind.ts`) tells what a space with
  no setlists is: **first use** (the welcome card: a personal space never synced and not in Drive),
  **being fetched** (a sync of a space never fetched is running: "Getting St Mark's songs and
  setlists…" with the sync's progress bar), **not fetched** (in Drive or a team's, never synced, nothing
  syncing: "Get them now"), or **empty** (fetched, or a team's, with no setlists: "St Mark's has no
  setlists yet"). "Fetched" is `last-sync.ts`'s note for the space, which every sync that ends well
  makes (`trackSync`, `sync-status.ts`, around the orchestrator's operations and the first sync of a
  team); the home page follows `SyncStatusEvent` and shows the setlists when the sync is over. The
  musician-type question (`first-use-setup`) is the device's, asked once, and is not about the space.
- **Declined teams.** Taking a team off this device ("Delete from this device") remembers its id in
  this browser (`declined-team-spaces`), so the next check does not put it back; **Look for my
  teams** does, and forgets the declining. This is the only state kept. A team the person has left, or
  that ended, is not listed, and its space stays on the device until they remove it.
- Not checked on a real Drive account: that an owner's second device can read the folder straight
  (`drive.file` is per app and account, so it should), and the first sync of a big team on a phone.

**As built** (`space-tabs.ts`, `<space-tabs>`, `team-join.ts`), where it differs from the above:
- The Shared tab is not a space that the app switches to: it goes to `/?shared` (the route
  `{ name: 'home', shared: true }`, its own view), which lists only what was shared, with the tab marked. On the Library and Add Song pages it is a way
  to that page. (Making `shared-with-me` the current space would put sync and the space record
  on a database that has neither.)
- "More" is a native `<select>`; the most recently used tabs (kept in `space-tabs-recent`) stay shown.
- Nothing on the invite path makes Personal: the first-use question and the start-up access check
  both wait when there is no space and the page is `/join`. Sign-in rename, repair page and export
  all work from the current space and need no Personal one.

## Copy and move between spaces (also the migration)

One general feature, built early because it unblocks your own migration and needs no Worker:
**"Copy/Move to space"** for songs, setlists, pads and whole spaces. It runs from the device's local
copy of the source (the app is offline-first, so it needs no access to the source's Drive) and
writes to the destination through whichever account owns it, so the two can belong to different
Google accounts.
- Songs: generalise `addToLibrary` (`other-songs.ts`), dedupe by `contentHash`; other charts arrive
  as variants of the song with the source's origin kept.
- Setlists (with their key and tempo per song): copy = new ids; **move keeps ids** and ends the
  source's copies. A whole-space copy/move reports added/skipped and is re-runnable, to bring
  across later changes.
- Pads live only in Drive, so they are copied/moved with Drive calls (`files.copy`, or `files.update`
  `addParents/removeParents` for a move; `supportsAllDrives` for shared-drive targets), not through
  the local DB.
- **Migration:** the "Creating a team space" wizard does this as one of its steps: the space is
  created, then songs (copied) and setlists (moved by default, or copied) are brought across. Pads
  are not. A move deletes the setlists, those in Drive too (their files go to the Drive trash:
  "Deleting setlists", SYNC_ARCHITECTURE.md). The same tool should serve succession, handing over or
  splitting a team space.
- **Built:** the core (`space-transfer.ts`: `copySongs`, `transferSetlists`, `transferSpace`,
  `bringAcross`, `contentsOf`), the wizard step, and moving one setlist from its info dialog.
  **Not built:** a "copy/move" for songs, or for a whole existing space, from the UI; and pads.
- Copying out of a team space into your personal space is allowed for any member (it is local data
  in Drives they control). The library's "Add to my library" for a song from another database is
  the one-song version.

## Read-only: local edits are never blocked

**Built (2026-10-19).** A user who can only read the Drive folder edits everything a writer does:
the `isReadOnlySpace()` gates are gone (setlist page, library, home, imports, nav menu, the
key and BPM controls). The one boolean left is `syncsBack()` (`space.ts`), and it removes
only what needs Drive: sharing by link (the song list to paste stays).
- For a personal space or an owner's, the trigger is Drive's folder `capabilities` or a refused
  upload (`refreshAccess()`, `space-access.ts`), kept as `readOnly` on the space record and in
  localStorage. For a team member it is the role the Worker reports: a reader's space is made
  `readOnly` when the team is joined or found (`team-spaces.ts`, `team-memberships.ts`, which also
  brings a known team's role up to date).
- Their changes are **never pushed**. They last on this device until a pull finds Drive's copy
  changed:
  - a **setlist** they changed is then replaced by the leader's version (the official plan wins; it
    is the order, keys and tempos that change at the last minute), and a toast tells them
    ("Your changes to <setlist> were replaced by the leader's version", `tellOfReset` in
    `sync-orchestrator.ts`; `resetSetlists` in `sync/pull.ts`). A setlist the leader did not change
    keeps their edits.
  - a **chart** they changed is left alone (`heldBack` counts it): chart edits are rare and
    deliberate. The sync says "view-only: your changes stay on this device" and how many differ.
- **Differs from official:** on the overview of a setlist the reader has changed, a small warning
  button in the header (`#differs-button`) opens `setlist-differs`, which says the change is not
  uploaded and will be replaced if the leader changes the setlist, and offers "Put it
  back to the official setlist" (`sync/revert.ts`: Drive's copy replaces the local one, keeping the
  id and the device state). A held-back chart has no marker yet; "Reset from Google Drive" on the
  Account and Teams page is its revert.
- The toast says what the leader's version has that theirs did not (`sync/setlist-diff.ts`: songs
  added and removed, a different order, a key or tempo, the details) and offers **Undo**, which puts
  their version back (still never uploaded). Undo lasts as long as the toast (15 seconds).
- **No guard for a setlist that is open or live, on purpose.** A leader's last-minute song must reach
  a live follower: blocking it would go against "permissive in the moment". It can happen
  mid-service, since the app syncs by itself (SYNC_ARCHITECTURE.md, "Immediate background sync"):
  the open setlist is updated in place (`applyChangedSetlist`), keeping the current song by its song
  id, saying what changed with the same summary, and keeping Undo.
- The marker does not yet list *what* differs (their value, the official one, whether the official
  one changed since). That, and a per-field merge, are the device layer in SYNC_ARCHITECTURE.md,
  "Several people editing a setlist".

**To do:** the Drive-capabilities trigger and the refusal counting can go for team spaces, whose
role is known. Anyone (a writer too) could choose "keep
this set local" later. A received share (the `readOnly` page option) should allow local edits the
same way: it is kept on the device on its own, so a key change there is harmless.

## Export and import

**Built (2026-10-19).** Account and Teams page, "Export and import" (`space-export-panel.ts`,
`space-export.ts`). An export is a zip of the current space that needs no Google account, and can be
imported into the current space on any device or account, which also makes it the way to move data
between two Google accounts. (It is called export and import, not backup and restore: it is a file to
carry, and the menu already has "Import Songs" and "Import a Setlist", which are other things.)
- **Contents:** `manifest.json` (format `chordless-export`, version, date, the space's name, counts),
  `songs.json` (each chart's record: id, variant, label, key, tempo, origin), `songs/<title>-<id>.cho`
  (the charts as ChordPro text, readable on their own), `setlists/<date>-<name>-<id>.json`. Nothing of
  Drive is in it (no file ids or checksums), no share links, no received shares, no deleted setlists.
  A device's own state (the capo, the sections shown) is not in it.
- **Pads are optional**, off by default, with the size shown beside the choice (`padSetSize`): they are
  large, and they live in the signed-in account's Drive, so they need the user signed in and online.
  They go in as `pads/<set>/<KEY>.mp3`, stored not compressed.
- **Import** adds what the space lacks and deletes nothing, and can be run again (the second run
  adds nothing): a chart is the same chart by content hash, a different chart of a song the space has
  arrives as a variant, a setlist is skipped if the space has its id (`transferSpace` in `import`
  mode: the setlist ids are kept and the file is not touched). Always into the current space: there is
  no "import into a new space", as an import only adds, so merging cannot harm the space, and keeping
  libraries apart is what team spaces are for. An imported setlist is local until the space syncs,
  like any other.
- **Reset from this export (built 2026-10-24, `space-restore.ts`)** is the other half: where an import
  only adds, a reset also *replaces* the charts and setlists here that differ from the file's, so a
  library can be repaired once, off to the side (edit the export, or take it from another space), and
  then taken by a space. Matching is by identity, a chart's uuid and a setlist's id, so the capo and
  sections kept on a device for a song stay with it, and a setlist's entries still find their songs.
  A record the file changes keeps its link to its file in Drive, so the next sync sends the change as
  an ordinary edit of the same file (no second file, no "start over"), and other devices take it like
  any edit. A record only in the file is added with its uuid. A record only here is **kept**, and
  counted: nothing is deleted, as deleting a file in Drive is a separate decision (and a setlist in
  Drive is deleted by "Deleting setlists" in SYNC_ARCHITECTURE.md, not by this). Before it does anything it shows the plan (what is replaced, added and
  the same, and which charts were changed here *after* the file was made, which the reset undoes),
  offers an export of the space as a backup, and asks. A setlist deleted here that the file has comes
  back. Limit: a space with two default variants of a song (one only here, one from the file) is not
  tidied. Chart text is compared, not the stored hash, which old records may not have right.
- **Importing pads** uploads them to Drive and is a separate tick; a pad set with the same name there
  is replaced.
- **Refused with a reason:** not a zip, no manifest, another kind of file, an export from a newer
  version (`version` is 1), a chart the list names but the zip lacks.
- `utils/zip.ts` reads and writes zip files with CompressionStream and a CRC-32 (the reader was in the
  pad-set service); checked against `unzip -t`.

## Sync: what differs per space

- **Transport per space** (the `setAccessTokenProvider` seam): personal/owner → googleapis with the
  own token; member → `/api/space/<id>/drive/...` with their Google ID token. One engine
  (`sync-manager.ts`, `sync/*`).
- **Conflicts:** Drive wins and the local edit is dropped, with a console warning, in every space
  (`sync/pull.ts`). Planned, not built: a conflict copy of dropped local edits, and serialised writes
  on the Worker (SYNC_ARCHITECTURE.md, "Several people editing a setlist"). **Built for team spaces:**
  an update carries the rev the device last synced the file with (`ifRev`), and the Worker answers
  409 and writes nothing if the file has moved on (check-then-write: two writes a moment apart can
  both pass). The device keeps the record changed, and its next sync pulls first.
- **Owner goes direct**, so it works if the team service is down.
- **Worker state:** a team space's rows in D1: members, roles, invites, the refs in its tree, the
  encrypted token blob (and a live room, a Durable Object with no storage). Never content. If the owner revokes the app, members see "owner needs to sign in again".
- **Immediate sync** (SYNC_ARCHITECTURE.md) is space-aware and built for both: a local save sends
  `DataChangeEvent`, and the page's `AutoSync` runs an incremental sync of the space in use after ~2 s
  of quiet, and on a tick (every 60 s in a team space, 5 minutes in a personal one). A team space has
  a feed of changes from the Worker (`/changes/start`, `/changes`) and a live channel, so a member
  sees an edit within seconds. No extra offline queue: a dropped push leaves the record "changed"
  (content hash vs `syncedContentHash`). 401/403/409 keep the local change and surface it. Role and
  membership are cached locally so a team space opens offline.

## Per-team-space encryption key: recommend no

It would stop the Worker (and Drive) reading chart text, making the principle "can't" rather than
"won't". But the owner's token in the Worker already grants full Drive access, so it doesn't protect
against token theft; it makes files unreadable in the Drive UI (the main benefit of a shared drive:
access and backup; plain chordpro in Drive is a feature); key loss or a missed rotation on member
removal destroys data; the key needs distributing (invite link fragment) and rotating on every
revoke; pad audio and `md5Checksum` conflict checks get more awkward. Low value, high cost. Revisit
only if a concrete threat appears. (Share links use a per-share key because they are public.)

## What the spike established (2026-10-19 and 20)

Run on a real Workspace shared drive with a Workspace account (the owner), a Gmail account (the
member), a throwaway dev Worker and a service account. The throwaway spike pages and the step-by-step notes are in git history.

| # | Question | Result |
|---|---|---|
| 1 | The Worker serves a second person the owner's folder, with roles | **Pass.** Reader, writer, and a stranger who knows every id (403). About 1.1 to 1.4 s a call on the dev server |
| 2 | A picked shared-drive folder takes every file operation | **Pass.** Create, list, get, update, download, subfolders, permissions, public link, `changes.list`. A Content manager cannot delete for good, so the app trashes (`trashFilesInFolder`) |
| 3 | The same from My Drive | **Pass.** The shared-drive flags are harmless there; `/about` takes the flag too (the app still does not send it) |
| 4 | A big file streams through the Worker, nothing kept | **Pass.** 20 MB up (2.1 MB/s) and down (10.3 MB/s), SHA-256 identical. Production limits unchecked |
| 5 | The stored token refreshes with no user present | **Pass.** Consent screen is In production, brand verified. A sign-in made under Testing dies in 7 days; the app now says "Sign-in expired" and offers Reconnect |
| 6 | A member's own token sees nothing of the owner's files, and cannot adopt the folder | **Pass.** So the Worker's team service is required, and succession of a team space is a copy |
| 7 | A service account in the shared drive does the whole job | **Pass.** JWT signed with WebCrypto, token with no user, and it sees the files the owner's client made |

**What it settles**
- Both ways of backing a team space (the owner's token, a Chordless service account) are real. Owner
  token stays the default; the service account is the upgrade, and it is simpler for the Worker:
  no refresh token to expire, no dependence on one person's sign-in.
- Without the Worker, members cannot share a folder at all under `drive.file`.
- Roles are enforced in the Worker, not by Drive, so a Content manager of the drive is the lowest
  role the account needs.
- The Worker streams a pad set through without holding it.

**What it changes**
- No One Tap. The page sends Google's ID token, renewed with the access token (design above).
- The service account is `team-storage@chordless-app.iam.gserviceaccount.com`, in the app project
  (a project of its own was considered and declined, 2026-11-10).

**Still open**
- The Cloudflare limits on a deployed Worker (request length, body size): only a deployment shows them.
- Whether an *external* service account can be added to a shared drive under a stricter Workspace
  sharing policy than the test one, and whether shared drives exist on the nonprofit tier.
- A permanent delete by a Content manager answered 404, not 403: unresolved, and it does not matter.
- Clock-time costs: Drive calls took 1 s or more each through the Worker, and `changes.list` runs
  3 to 6 s behind a change. Pulls by a timer are fine; anything wanting faster has the live channel (a WebSocket in the space's room, a Durable Object with no storage, that makes the others sync now: LIVE_SYNC.md).

## Order of work and status

Checked against the code 2026-11-12.

1. [x] Principle in CLAUDE.md and this doc.
2. [x] Spike: passed, see "What the spike established".
3. [x] Space abstraction: space id and `rootRef`, the folder Picker, the shared-drive flags,
   per-space transport through `StorageBackend` (docs/STORAGE_API.md). Left: the space's kind is
   not a field of its own (a team space has `team` set, personal does not).
4. [ ] Copy/move between spaces. Built: the core for songs, setlists and whole spaces
   (`space-transfer.ts`), the wizard's step, moving a setlist (also out of Drive in the source), and
   export and import for the hop between accounts. Not built: a UI to copy or move songs or a whole
   space, and pads (Drive calls).
5. [x] Read-only rework: gates removed, `syncsBack`, pull skips records with local changes, the
   "differs from official" button with revert (setlists), the role from the Worker for team members.
   Left: the what-differs list, charts' marker, dropping the capabilities trigger for teams.
6. [x] Per-space pads and "Save to" (2026-11-10). Left: the team default pad sound (TODO), and
   bringing pads across (item 4).
7. [x] Worker team service: the API for members, identity, D1 state, the register, invites, joining,
   roles, licence, deleting a space, the changes feed, the live channel, pads, the Account and Teams
   page and the join page. Left: serialised writes (the 409 check is not atomic), and probing protections (item 11).
8. [ ] The team space wizard. Built: name, parent folder (Picker), bring songs and setlists, invite,
   result and retry. Not built: the shared-drive choice and the service account in the wizard, and
   pads. The header switcher and Merged/Separate are dropped; the default space ("Presenting
   spaces") replaces them, proposed.
9. [x] Space-aware immediate sync for team spaces, with the Worker's feed of changes and the live
   channel.
10. [x] Team-managed storage: the service-account provider, "Check and switch" and rollback, deleting
    the owner's token on the switch. Tried with real teams 2026-11-12. Left: moving a folder into a
    shared drive (step 1 of the upgrade flow).
11. [ ] Probing protections: unguessable or signed space ids, per-account rate limits, key rotation
    (SECURITY.md).
12. [x] Teams on another device (`GET /api/spaces`), tabs, invites bound to an email, Send…, deleting
    a space, deleting and moving a setlist.

Items carried over from the TODO (space section): a media-team email config option; restrict
editing others' setlists by `ownerId` (SYNC_ARCHITECTURE.md, "Several people editing a setlist").

## Deleting a space

Built 2026-11-12 (`space-deletion.ts`, `space-delete-everywhere.ts`, the Worker's
`DELETE /api/space/<id>/everything`). Two ways, both on the space's Data window:

- **From this device.** Its database here, and nothing else: the Drive folder stays, and a Team stays
  shared (the person can join again with a new invite).
- **Everywhere.** The space's Drive folder, with everything in it, goes to the **Drive trash**
  (recoverable there for thirty days; emptying the trash makes it permanent), and then it is gone from
  this device. Drive first: if the folder cannot be trashed, nothing is deleted and it can be tried again.
  - **Who may.** A personal space: the person using it. A Team: an **admin or the owner** (the
    Worker enforces it; a writer or reader is told it is for admins). A Team's folder is the owner's, or
    on a shared drive the service account's, so the Worker trashes it, with the space's own credential
    (`AdminContext.trashRoot`), and then ends sharing (`destroy`), so the members, invites and token go and
    only the team's register row and events stay, marked ended (see "The register of teams").
  - **Three things asked before it does.** A **backup** the page makes itself and hands to the browser
    (`downloadBackup`, the same export as the export panel: songs and setlists as they are on this device,
    no audio pads; a sync first if others changed it), the space's **name typed**, and a press of a button
    that says what it does. It cannot be known that the browser saved the file; only that it was made
    and handed over. The audio pads in a Team's folder go to the trash with it.
  - **Other devices** of the same person stop syncing it rather than bring it back: the sync finds the
    linked folder trashed and stops with `DriveFolderGoneError` ("this space's Drive folder is gone",
    `startOver()` the way on). A Team's other members' devices find the space gone from the Worker.
  - **Needs Drive reached**: a sign-in with Drive (for a Team a sign-in alone, as the Worker holds the
    credential). Signed out, only "from this device" is possible.
- **The space in use may be deleted** either way. It is replaced by another space on the device, or none
  (Personal is made again when the app needs one), and the page starts again in it. (The old rule
  "switch to another first" was about the open database connection, which a window of the app lets go of
  when asked to: `onversionchange`.)
- **Setlists of a space that stays.** A move into a Team copies songs (a deleted chart comes back),
  and moves the setlists: those in Drive go to the Drive trash too (`docs/SYNC_ARCHITECTURE.md`,
  "Deleting setlists"). One setlist can be moved from its info dialog, in edit mode, to put right one
  added to the wrong space.

## Risks

- Consent screen must be "In production" or refresh tokens die in 7 days. **Met:** it has been In
  production for over a week with the brand verified (2026-10-19). A sign-in made before that kept its
  7-day life and expired; reconnecting made one under production. If an `invalid_grant` comes again,
  the other causes are access revoked, six months unused, the per-account limit on refresh tokens for
  one client, and a Workspace admin's session-length policy (which could affect a team owner's
  account, and the team service holds that token).
- The Worker carries team-space traffic including pad audio (cost, limits).
- Owner-token mode: the owner leaves or revokes and sync stops; succession is a copy. (Solved by
  team-managed storage for teams on a shared drive.)
- A Chordless-operated service account concentrates risk: one leaked key reaches every team that
  shared a drive with it. Keep it in a Worker secret, rotatable, and scope every call to the team's
  folder tree.
- The spike ran on a Workspace shared drive; stricter shared-drive admin policies than the test one are untested ("Still open" above).
- A consent-screen/verification change, or Google restricting `drive.file` further, would undermine
  the whole team-space design.

## Tests

`just format lint test` after each step. Worker team-service tests use `fake-auth-worker.ts` /
`fake-drive.ts` extended with a second user and shared-drive flags. To cover: create a team space
with a chosen parent; enable sharing; join; reader edits stay local and survive a pull; reader can
upload but not delete pads; admin can delete; move personal → team keeps setlist ids and moves pads;
tabs hidden with 1 space and shown with 2; the default space, once built; the Worker never persists bodies.
Manual two-account run for the spike and the team-service and UI steps. Log real defects in
`docs/test-catches.jsonl`.

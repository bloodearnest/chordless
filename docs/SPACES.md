# Spaces

The single home of the space model: what a space is, where its data lives, who may do what, how
people are invited, how data moves between spaces, and how read-only works. Share links (one
setlist sent to people without an account) are in SHARING.md. How sync itself works is in
SYNC_ARCHITECTURE.md.

> **Status:** the personal space and the single-user sync described under "Today" are built. The
> team space is built end to end for the owner's-token credential (the Worker's team service, roles,
> invites, joining, the Account and Teams page), tested against fakes only; the service account, pads, copy/move
> UI and the rest are **designed, not built**. The order of work, a status list and where work
> stopped are at the end. The code and docs
> call it a space throughout (it was "organisation" until 2026-10-20: see "Naming").

## Principle

**Chordless never stores copyrighted content; it only passes access on to it.** Charts, lyrics and pad
audio live in the user's own browser and in a Drive the user (or their team space's owner) controls.
The Worker passes team-space traffic through (streamed, never buffered to storage) without
persisting or caching it: no KV, R2, Durable Object or Cache API entry may hold song, setlist or pad
content. They hold only membership, roles, the owner's encrypted token blob and checksums. (Share
links are the one exception: the Worker caches ciphertext it cannot read.)

Churches using Chordless are expected to hold a CCLI licence, which covers sharing charts with the
members of their church. Each space is self-contained, so copyright compliance is per space.

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
by the wizard (see "Creating a team space", below). The Account and Teams page's Space section therefore only
lists the spaces on this device and switches between them; it no longer has "Create New Space".

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
| Pads | `Chordless/pads/` | `<team folder>/pads/` |

**Folder choice.** On create, the owner picks a *parent* folder; the app then creates `<team name>/`
inside it (`songs/`, `setlists/`, `shares/`, `pads/`). Because the app creates the team folder,
`drive.file` grants it everything inside. A Picker-picked folder alone exposes no children (the
2026-10-13 finding), so the picked folder must not be the team folder itself. The picker copy
recommends a **shared drive** (members can see the files in Drive, the files survive the owner
leaving, Google backs them up) but a My Drive folder is fine. Shared drives need `supportsAllDrives`
and `includeItemsFromAllDrives` on every Drive call (not in `drive-api.ts` today) and the Picker API
(API key, app id `818185619377` (the `chordless-app` project number), CSP for `apis.google.com`, `docs.google.com`, `www.gstatic.com`).

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
- **Deleting a space:** a space's Manage modal on Account and Teams, "Delete from this device":
  not available for the space being worked in (switch first), and after a confirmation that names it. It removes the space's record and
  its local database (setlists, songs, charts); nothing in Google Drive is touched, so a folder it
  synced to stays there for the user to delete.
- Spaces are completely isolated: songs and setlists belong to exactly one; switching shows the
  home page afresh on the other database (no page reload: `switchSpace` in `space.ts` sets the
  current space, tells `SpaceChangeEvent`, and goes to `/` with `{ fresh: true }`); a setlist references only its own space's songs; the same CCLI song in
  two spaces is two separate instances.

### Finding the Drive folder

- The first sync on a device finds the folder **by name** (so a new device joins an existing
  space) and stores its id on the space record (`rootRef`). Later syncs use the id, so a
  rename can't point sync at a different folder.
- After a rename, sync renames the Drive folder to match, unless another folder has that name; if
  the device has nothing synced yet, it joins that existing folder instead.
- If the linked folder is trashed or gone, sync stops with an explanation rather than creating a
  new one.
- Finding by name goes away for team spaces (the id is issued and stored); it stays for the
  personal space.

### Setlist leaders

A setlist's leader is `owner` (name) + `ownerId` (Google account email; empty for a leader typed in
by name with "Other…"). The Leader dropdown lists the folder's members (cached at sync, from Drive
permissions) plus the signed-in user, who is the default for new setlists. With the team service, the
member list comes from the Worker instead.

### Sign-in model

The Worker keeps no per-user state (until the team service adds its Durable Objects).

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
  `401 invalid_grant` and the client throws `SignInExpiredError`. `getSignInState()` is
  `signed-out`, `signed-in` or `expired`; only Google's refusal makes it `expired` (no network, or
  any other failure, counts as signed in). The Account and Teams page then says "Sign-in expired", offers
  "Reconnect with Google", and disables the sync panel with the reason.
- **Scope:** `drive.file openid email profile`. Drive access is limited to files the app created
  (or the user picked with the Picker).
- **Who is asking the team service (built 2026-10-21):** Google's own ID token, as
  `Authorization: Bearer`. Google sends a new one (an hour, checked on a real refresh) with every
  refreshed access token, so `/session/refresh` passes it on and the page keeps it beside the access
  token. `getIdentityToken()` (`google-auth.ts`) renews it silently (`getIdToken` is the old
  One Tap prompt, which is not used for this). The Worker side is `worker/src/identity.ts`: an
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
                               2. ask the space's Durable Object: what role?
                               3. refuse, or carry on
                               4. use the space's Drive credential ──► Drive
   page ◄── the files ─────────┘
   ```
   The member's own Drive access plays no part, and the member needs none. The Worker uses the
   space's credential (the owner's token from the owner's blob in the Durable Object, later the
   service account), so Drive sees one account acting for the whole team.
5. **The space's owner syncs** directly, as in 3: they own the folder.

The ID token is for the Worker's access control only: it says who is asking, the Durable
Object says what they may do, and the Drive credential does the reading and writing.

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
   already issues) in the team space's Durable Object, with its member list and a role for each.
2. A member signs in with the ordinary `drive.file` scope (no warning screen). Their app sends its
   Drive calls to `/api/space/<id>/drive/...` with their Google ID token. The Worker checks the
   member list and forwards the call with the **owner's** token, which covers every file the
   owner's app created.
3. The Worker enforces the role and keeps calls inside the team folder's tree, so roles are enforced
   on the server and nobody needs the Drive folder shared with them. The client change is small:
   `drive-api.ts` already has `setAccessTokenProvider`.

Costs and risks: the Worker carries the traffic; the Durable Object holds a token that reaches
everything the owner's app made; if the owner revokes the app or the token expires, sync stops for
everyone (the consent screen must be "In production": refresh tokens last 7 days in "Testing").

## Creating a team space (the wizard)

**Decided 2026-10-22, not built.** The adoption path is: someone at a church tries Chordless on
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
     and the owner's token is never stored. Not built; the step is there so the wizard does not
     have to change shape when it is. Until then it picks a folder on the shared drive and uses the
     owner's token like any other.
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
     setlist already saved to Drive cannot be removed from the source until "Deleting setlists" is
     built: it stays, and the result says how many.
   - They go through `space-transfer.ts` (`contentsOf` counts, `bringAcross` does it; the local
     databases, no Drive access to the source needed). A copy gives setlists new ids, a move keeps
     them (as "Copy and move" says), so this is that code and not the export file's import.
   - The space is made first. If bringing things across then fails, the result page says why and
     offers "Try again" (it is re-runnable: what is there is skipped).
   - **Pads are not in this step yet.** They are the account's, not a space's (item 6), and need
     Drive calls. When they are, the checkbox is hidden if there are none.
4. **Invite people** (built 2026-10-22; `team-invite-step.ts`, on the result page once the space
   exists, since an invite needs its id). The setlists brought across have leaders (`owner` and
   `ownerId`, an email). Leaders with an email are listed once each (`leadersOf`), ticked, with a
   role to choose (writer by default), and an email can be added by hand; the person making the
   space is left out. Nothing is sent without being ticked, and Chordless sends nothing itself:
   each invite is a link, shown once, to copy and pass on. A leader typed by name alone has no
   email and is listed as someone who cannot be invited. A refused invite stays in the list to try
   again. Invites are the existing ones (single use, bound to the email, a week).
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
| Credential in the Durable Object | the owner's encrypted refresh token | none per team: the team shares its drive with Chordless's service-account address; the key is a Worker secret |
| Single owner? | yes; owner leaving or revoking stops sync; succession by copy | **no**: the files belong to the shared drive; any number of Chordless admins |
| Blast radius | one person's `drive.file` files | whatever each team shared with the account; a Worker bug could touch every team that did |
| Setup | automatic | "Add `<address>` as Content manager of your shared drive" → "Verify" |

**Why shared drives only:** a service account has no storage quota, so it can't create files in
someone's My Drive folder, but files it creates in a shared drive belong to the drive. That is also
what makes ownership disappear as a problem.

**Upgrade flow (team space settings → "Team-managed storage"):**
1. Choose or create the shared drive and move the team folder there if it isn't (the copy/move tool).
2. Show the service-account address and the exact role to grant: Content manager. Contributor can't
   trash, so pad rules would be Worker-only. Content manager **can trash but not permanently delete**
   (only a Manager can; checked 2026-10-19 with a Content manager's token: `canTrash` true,
   `canDelete` false, and a permanent delete answers "File not found"), which is why the app only
   ever trashes.
3. "Verify" makes the Worker test read/write/trash with the service account.
4. The Worker switches that team space's transport to the service account and **deletes the owner's
   stored token blob** (which also removes the broad personal token from the Durable Object).
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
a project of its own (docs/CLOUD_MIGRATION.md, step 6). Revisit with many teams or if the spike
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
- **Pad sets** are not in the team service's first cut: they are the account's today
  (docs/STORAGE_API.md); they move into the space, then the Worker streams them.

Built 2026-10-21 (`worker/src/team-admin.ts`, routes at its top):
- **Making a space:** `POST /api/spaces` with the page's blob, the folder and a name. The Worker
  checks the blob is the caller's (`owner_sub` against the ID token) and that it sees the folder,
  writable and not in the bin, then issues the space's id and keeps the blob in a new Durable
  Object. The owner's client keeps the id (nothing records a folder against an id on the Worker, so
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
  out is the page's, with the space id and code in its fragment (not built).
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
- **Upload pads: any member**, readers included (create-only, `pads/` folder only).
- **Delete pads: admin and up.**
- **Delete setlists** (decided 2026-10-22): a **writer may delete a setlist they lead** (its
  `ownerId` is their verified email); **only an admin (or the owner) may delete one someone else
  leads.** A reader never.
- **Delete songs: admin and up.** A song is shared by every setlist that uses it.
- **In a personal space the person is implicitly an admin** and may delete anything: they are a
  grown-up, and the backup (export) feature is there. **Every delete asks for confirmation, in every
  case**, danger-styled, naming the effect (CLAUDE.md: friction, not prohibition).
- How a deletion works is in SYNC_ARCHITECTURE.md, "Deleting setlists". The Worker checks the role
  on the server. To know who leads a setlist without reading its body, the setlist's file carries
  `ownerId` as a file property (kept current on every push), and the storage API's `status` returns
  a file's collection and its properties. Until restrictions on editing others' setlists exist
  (SYNC_ARCHITECTURE.md), a writer can make themselves the leader first, so the rule guards against
  mistakes, not a determined writer.
- Invite, remove, change roles, enable/disable sharing: admin and up (owner for disable/transfer).

Undecided: whether writers may edit others' setlists (see "Several people editing a setlist" in
SYNC_ARCHITECTURE.md), and an admin's finer powers.

## Pads in team spaces

Pads move from account-global to per-space (`pad-set-service.ts`, `pad-keys.ts`, `drive-api.ts`, the
service-worker cache `padsets-cache-v1`; the cache key gains the space id). The upload dialog gets a
"Save to" choice (your personal space, or any team space you're a member of). The pad picker lists
pads from all your spaces tagged by source, like songs. Audio is large: the Worker **streams** it
through (no buffering, no cache). Check Worker body-size limits in the spike. A signed, short-lived
direct download is *not* possible under `drive.file`, so if pad audio can't go through reasonably
the fallback is "pads for team spaces only via the owner's direct path" (members upload through the
Worker in chunks, or the size cap is lowered).

## Presenting spaces: user preference

Setting "Spaces: Merged / Separate" in Preferences.
- **Hidden entirely with one space** (the common case): no switcher, no badges, no choice.
- **Merged (default once there is more than one space):** Home lists setlists from all spaces
  badged/grouped by space; the library already merges (`other-songs.ts`), with a filter bar over the list (`library-space-filter.ts`, shown with two or more places) to switch a space's songs off; what is left out is kept in this browser (`library-spaces.ts`). New setlist uses a default
  space (last used, changeable).
- **Separate:** one active space, header switcher, everything scoped to it (today's model, with the
  switcher moved from the Account and Teams page to the header).
- A setlist belongs to exactly one space and references only that space's songs.

Ship Separate first (mostly today's code: `getCurrentDB()`, switch = reload). Merged needs setlist
routes to resolve a space from the id and views to query several databases.

**Creating a setlist.** The form always says which space it is created in (a header line "New
setlist in Grace Church", plus the kind label when you have more than one space). With one place to
save there is nothing to choose. With more than one (Merged), it is a "Save to" field pre-filled
with the last one used, offering only places you can write to; in Separate mode it is the active
space, read-only text. A wrong choice is fixed with "Move to…" (keeps the setlist id).

## Space tabs, and joining by invite (decided and built 2026-10-23)

The reason: someone tries Chordless alone, then their church makes a team and invites them. Their
songs and setlists must not seem to vanish, and someone whose first contact is an invite should
never meet a "Personal" space they did not ask for.

**Tabs under the header** of the Setlists, Library and Add Song pages, replacing the title-only
"Setlists - Gateway Church" as the way to see and change space.

- One tab per place: each Team (by its own name), Personal (by the person's name once signed in),
  and **Shared** (the `shared-with-me` database, `docs/SHARING.md`). A small Team/Personal label sits
  beside the name, so two teams are never both "Team".
- **Only tabs that exist.** One place means no tab bar (the rule under "Presenting spaces"); Shared
  appears only when something was shared; a Personal space with nothing in it (and not the current
  one) has no tab. It returns as soon as something is saved there, and the Account and Teams page can
  always show it.
- Fixed order (Teams, Personal, Shared), the current tab marked. About three or four fit a phone;
  beyond that the rest go under a "More" menu, the most recently used staying as tabs.
- A tab is the space switch (the home page, made afresh: no reload). Reading another space's database
  without switching the app is "Merged" (above), later.
- A `role="tablist"` under the header, with arrow keys (as `chart-diff` does), never in the header,
  so it stays clear of the live-setlist controls. Account and Teams stays for managing spaces
  (create, leave, rename), not for switching.
- "Shared" is a tab of its own, not only a group at the foot of the home page.

**Joining by invite**
- Accepting an invite makes the team the current space and the first tab.
- **Bring across what is new.** If the personal space holds anything the team does not already have,
  ask once: "You have 14 songs and 3 setlists in Personal. Bring them into Gateway Church?" It uses
  `contentsOf` and `bringAcross`, skipping anything the team space has already (songs by song id,
  setlists by id), and counts only what would be added. No prompt when nothing would be. Songs are
  copied; setlists moved or copied, as in the wizard. Declining is harmless and the same action stays
  on the Account page, on each space's card with its counts.
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

**As built** (`space-tabs.ts`, `<space-tabs>`, `team-join.ts`), where it differs from the above:
- The Shared tab is not a space that the app switches to: it goes to `/?shared` (the route
  `{ name: 'home', shared: true }`, its own view), which lists only what was shared, with the tab marked. On the Library and Add Song pages it is a way
  to that page. (Making `shared-with-me` the current space would put sync and the space record
  on a database that has neither.)
- "More" is a native `<select>`; the most recently used tabs (kept in `space-tabs-recent`) stay shown.
- The offer to bring across is made on the join page once the first sync has run, looking at each
  personal space in turn; setlists are moved (the wizard's default). The matching action on the
  Account page's cards is **not built yet**: until it is, the wizard's step is the only other way.
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
  created, then songs, setlists and pads are moved (the default) or copied from the personal space.
  The personal space is then empty and stays as the place for private sets. A move can delete
  setlists that are in Drive once "Deleting setlists" (SYNC_ARCHITECTURE.md) is built; until then
  those stay in the source and are counted in the report. The same tool serves succession, handing over or splitting a team space.
- Copying out of a team space into your personal space is allowed for any member (it is local data
  in Drives they control). The library's "Add to my library" for a song from another database is
  the one-song version.

## Read-only: local edits are never blocked

**Built (2026-10-19).** A user who can only read the Drive folder edits everything a writer does:
the `isReadOnlySpace()` gates are gone (setlist page, library, home, imports, nav menu, the
key and BPM controls). The one boolean left is `syncsBack()` (`space.ts`), and it removes
only what needs Drive: sharing by link (the song list to paste stays).
- The trigger is still Drive's folder `capabilities` or a refused upload (`refreshAccess()`,
  `space-access.ts`), kept as `readOnly` on the space record and in localStorage. Under
  `drive.file` it cannot fire for a person with only read access to someone else's folder, so until
  the Worker reports a role this only covers a folder that really is read-only.
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
  a live follower: blocking it would go against "permissive in the moment". Today it cannot happen
  mid-service anyway, because a sync only runs when the user presses it on the Account and Teams page. When
  updates can arrive while a setlist is open (immediate sync, or the leader pushing over WebRTC,
  opt-in), apply them in place: keep the current song by its song id, say what changed with the same
  summary, and keep Undo. The diff is pure so both sources can share it.
- The marker does not yet list *what* differs (their value, the official one, whether the official
  one changed since). That, and a per-field merge, are the device layer in SYNC_ARCHITECTURE.md,
  "Several people editing a setlist".

**To do:** when the Worker reports roles, `syncsBack(space)` comes from the role and the
Drive-capabilities trigger and the refusal counting can go. Anyone (a writer too) could choose "keep
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
- **Importing pads** uploads them to Drive and is a separate tick; a pad set with the same name there
  is replaced.
- **Refused with a reason:** not a zip, no manifest, another kind of file, an export from a newer
  version (`version` is 1), a chart the list names but the zip lacks.
- `utils/zip.ts` reads and writes zip files with CompressionStream and a CRC-32 (the reader was in the
  pad-set service); checked against `unzip -t`.

## Sync: what differs per space

- **Transport per space** (the `setAccessTokenProvider` seam): personal/owner → googleapis with the
  own token; member → `/api/space/<id>/drive/...` with their Google ID token. One engine
  (`drive-sync.ts`, `sync/*`).
- **Conflicts:** personal spaces are single-writer: keep Drive wins plus a conflict copy of dropped
  local edits. Team spaces add the Worker checksum precondition (409) and a Durable Object per space
  to serialise writes (SYNC_ARCHITECTURE.md).
- **Owner goes direct**, so it works if the team service is down.
- **Worker state:** one Durable Object per team space: members, roles, encrypted token blob. Never
  content. If the owner revokes the app, members see "owner needs to sign in again".
- **Immediate/offline sync** (SYNC_ARCHITECTURE.md) is made space-aware: `syncSoon({type, id,
  spaceId})` → service worker, ~2s debounce, per-record push, Web Lock `chordless-sync:<spaceId>`, a
  token provider per transport from the same sign-in blob. No extra offline queue: a dropped push
  leaves the record "changed" (content hash vs `syncedContentHash`). 401/403/409 keep the local
  change and surface it. Role and membership are cached locally so a team space opens offline.

## Per-team-space encryption key: recommend no

It would stop the Worker (and Drive) reading chart text, making the principle "can't" rather than
"won't". But the owner's token in the Worker already grants full Drive access, so it doesn't protect
against token theft; it makes files unreadable in the Drive UI (the main benefit of a shared drive:
access and backup; plain chordpro in Drive is a feature); key loss or a missed rotation on member
removal destroys data; the key needs distributing (invite link fragment) and rotating on every
revoke; pad audio and `md5Checksum` conflict checks get more awkward. Low value, high cost. Revisit
only if a concrete threat appears. (Share links use a per-share key because they are public.)

## Spike first: can the planned design work?

Throwaway Worker route plus two real Google accounts (FakeDrive can't prove `drive.file`
behaviour). Pass/fail, in order:
1. Owner's token via a Worker route: a second user's request lists and reads files in the owner's
   app-created folder.
2. Owner picks a **shared-drive folder** in the Picker, the app creates `<team>/` inside it with
   `supportsAllDrives`; create, list, read, update, delete files and subfolders there with the
   owner's token (Workspace admin policy permitting).
3. Same from a **My Drive** parent.
4. Stream a ~20 MB pad file up and down through the Worker without buffering; note limits.
5. Stored token blob: refresh works from the Worker with no user present (consent screen "In
   production"; 7-day refresh expiry in Testing).
6. Confirm a *different* member of the shared drive, using their own `drive.file` token, cannot see
   the owner's files (confirms the team service is required) and a new owner token cannot adopt the
   folder (confirms succession = copy).
7. **Service account:** in a shared drive, a Chordless service account added as Content manager can
   create, list, read, update and delete files and folders (`supportsAllDrives`); the Worker can
   mint its access token (RS256 JWT signed with WebCrypto, exchanged at Google's token endpoint)
   with no user present; it can reach nothing that wasn't shared with it; and an external service
   account can be added at all under a typical Workspace sharing policy. Also confirm shared drives
   are available on the nonprofit Workspace tier, and that a free Gmail user cannot create one (so
   owner-token stays the default path).

If 1 or 2 fail, stop and rethink (fallback: team folder only in the owner's My Drive).

### Spike results (2026-10-19 and 20): the design works

Run on a real Workspace shared drive with a Workspace account (the owner), a Gmail account (the
member), a throwaway dev Worker and a service account. Detail of each run is below.

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
  for now (docs/CLOUD_MIGRATION.md, step 6 is a project of its own).

**Still open**
- The Cloudflare limits on a deployed Worker (request length, body size): only a deployment shows them.
- Whether an *external* service account can be added to a shared drive under a stricter Workspace
  sharing policy than the test one, and whether shared drives exist on the nonprofit tier.
- A permanent delete by a Content manager answered 404, not 403: unresolved, and it does not matter.
- Clock-time costs: Drive calls took 1 s or more each through the Worker, and `changes.list` runs
  3 to 6 s behind a change. Pulls by a timer are fine; anything wanting instant needs WebRTC.

The throwaway code (`worker/src/spike-broker.ts`, `spike-service-account.ts`, `src/dev/broker-spike.*`,
`src/dev/shared-drive-probe.*`, `src/dev/picker.js`, and their tests) was deleted on 2026-10-20 when the
spike was done. It is in git history (`git log --diff-filter=D -- worker/src/spike-broker.ts`); the
service account's JWT signing in `spike-service-account.ts` is the part the real team service will want. The
"Ready to run" notes below describe the pages and routes as they were.

**Ready to run, item 1 (2026-10-19):** `/dev/broker-spike.html` and a throwaway Worker route
(`worker/src/spike-broker.ts`, `POST /dev/spike/enable` and `/dev/spike/drive`; 404 unless
`DEV_PAGES`, so dev only; the owner's token is kept in the dev server's memory and nowhere else).
- *Owner* (browser profile signed in as account A): optionally pick a parent folder (Picker), list
  the people allowed (an email and `reader` or `writer` per line), press "Make a team folder and
  enable sharing". It makes a folder with a file, a subfolder with a file, and a file outside it,
  hands the Worker the owner's blob and folder, and gives a member code to copy.
- *Member* (another browser profile signed in as account B, on the same dev server): paste the code,
  say what role B should have, press "Run the member checks". It lists the folder, reads a file in it
  and one in a folder inside it (timed), asks for the file outside (must be refused), and tries to
  write (a writer may, a reader must be refused). Running it as account A, who is not in the list,
  with "not a member" should be refused everywhere.
- The member's calls carry only their own Google ID token (`getIdToken`, a Google sign-in prompt, which
  has not been used this way before: if the browser suppresses it, that is the first thing to report).
  The Worker checks the token, the member's role, and that the file is inside the team folder
  (walking up its parents), then calls Drive with the owner's access token and streams the answer.
- **Reader result (2026-10-19): passed** for a second account through the Worker, on a team folder in
  the shared drive: list, read a file, read one in a folder inside it (about 1.1 to 1.4 s each on the
  dev server), the file outside the folder refused, and the write refused. **Writer: passed** (the
  write is accepted, the outside file still refused). **Not a member: passed** (a stranger who knows
  the space id and the file ids gets 403 on everything). One run of "not a member" first showed
  200s: the wrong account was behind the Google popup, a listed one. The Worker now stamps each answer
  `X-Spike-Member: <email> (<role or not a member>)` and the page shows it first, so a mix-up of
  accounts is visible. **Item 1 is done** for the owner's token, on a shared-drive folder, with a
  Content manager.
- **Do not build the real team service on One Tap.** The member's ID token here comes from
  `google.accounts.id.prompt()`, which Chrome shows as a native FedCM popup ("Sign in as …"), not an
  OAuth window. Other browsers show Google's own card in the page or nothing, Google is retiring that
  fallback and the moment notifications `getIdToken` relies on, a few dismissals silence it for a
  while, and an old iPad is the target. It was only the quickest way to make the spike run. The
  design: the normal sign-in popup (`initCodeClient`, which works everywhere) already gives the
  Worker a verified ID token, and a refresh (`/session/refresh`, which has the encrypted blob as proof
  of identity) returns a new ID token with every new access token (checked on a real refresh,
  2026-10-21), so the page sends that to the team service. No prompt, any browser, no per-call
  popup, and no Worker signing key. (Current dates for Google's retirement not checked.)
- **Item 4, a big file:** `POST /dev/spike/upload?space=…&name=…` takes the file as the raw body with
  `X-Id-Token` and `Content-Length`, for a writer only. It opens a resumable upload to Drive with the
  owner's token and passes the body on as it arrives, through a `FixedLengthStream` of exactly that
  length where Workers has one, never holding it. The page makes random bytes of a chosen size (up to
  140 MB), sends them, reads them back with the existing streamed `read`, and compares SHA-256, with
  timings (when the answer starts, when it ends, MB/s). What this shows is that streaming works end to
  end, not the production limits: the dev server does not enforce the plan's limits. From the
  Cloudflare documentation as I remember it, and not checked today: a request body up to 100 MB on the
  Free and Pro plans (more on Business and Enterprise), no limit on a response body, and CPU time
  counts compute, not time spent waiting on a stream. A pad set is 12 files of a few MB each, well
  inside that. Whether a request that long is cut off at the edge on a real deployment is the thing
  only a deployed Worker can say.
- **Item 4 result (2026-10-19): passed, 20 MB.** Up through the Worker to the shared drive: 200, 9.7 s,
  2.1 MB/s, Drive reports exactly 20,971,520 bytes. Back down through the Worker: the answer started
  after 1.2 s and ended after 1.9 s (10.3 MB/s), 20,971,520 bytes, SHA-256 identical to what was
  sent. So streaming works end to end with nothing kept in the Worker. The speeds are those of the
  dev machine's own connection (the dev Worker runs there), not of a deployed Worker, so they are a
  pessimistic guide; the plan's production limits are still unchecked on a real deployment. A pad
  set (12 files of a few MB) would take tens of seconds to upload on a slow link, once.
- **Item 7 result (2026-10-20): passed.** The Worker signed an RS256 JWT with WebCrypto and Google
  gave a token with the `drive` scope, no user present. As a Content manager of the shared drive the
  service account read the team folder (`canAddChildren` and `canTrash` true, `canDelete` false),
  listed it **including files the owner's Chordless client had made** (which `drive.file` hides from
  any other client), created a file, read it back, replaced its content and trashed it. The permanent
  delete of the trashed file answered 404, not the expected 403: it does not say whether a Content
  manager may delete for good, and does not matter, as the app only trashes. Still unchecked: that an
  external service account can be added under a stricter sharing policy than this one, and the
  nonprofit tier.
- **Item 6, no Worker** (run as the *other* account, a member of the shared drive, with the member
  code from the owner part; the code now includes the team folder's id):
  - **6a** "try my own token on the team's files": this account's own Chordless sign-in lists the team
    folder and reads the folder, a file in it, and a file in a subfolder. All must be refused or empty.
    A pass confirms `drive.file` is per app and per user on a shared drive too, so the team service is
    needed (a "seen" would mean members could sync a shared drive directly, a much simpler design).
  - **6b** "pick the team folder, and see what I get": the Picker (the API key in the owner part)
    picks the team folder with this account. The pick grants the folder, but listing it must still
    show nothing and the old owner's files must stay refused, which is why there is one live owner
    per team space and succession is a copy.
  - **Item 6 result (2026-10-20): passed.** Run as the Gmail account, a member of the shared drive.
    6a: nothing listed, and the folder, a file in it and a file in a subfolder all refused (404), so
    `drive.file` is per user and per client on a shared drive too, and the team service is needed. 6b: the
    pick granted the folder it was given and nothing under it (listing showed nothing; the old
    owner's song stayed refused), so a new owner cannot adopt the folder's contents and succession is
    a copy. The page marked one row "fail" only because the account picked the parent folder
    ("Chordless") and not the spike's own subfolder, which the pick made no difference to.
- It uses the lowest roles that work: a Content manager of the shared drive (or any editor), not a
  Manager, since the app only ever trashes.

**Run 2026-10-19 on a real My Drive (empty parent):** every file call passed with the flags (create,
list, get, update, download, permissions, batch delete, trash), and `/about` accepted the flag too.
`changes.list` saw nothing at once but did after 5.7 s on a retry: it works under `drive.file`, and
trails a change by a few seconds. Making a file public and removing that (the share-link calls) also
passed. A shared-drive folder is still untested.

**Ready to run:** `/dev/shared-drive-probe.html` (served by `just serve`, signed in on the Storage
page) makes a folder, then creates, lists, gets, updates, downloads, reads permissions, batch
deletes and trashes with the app's own `drive-api.ts` calls, and also tries `/about` with the flag.
Empty parent: your My Drive (checks the flags do no harm to everyone's sync).

**Picking a shared-drive folder (spike item 2):** under `drive.file` the token only sees a folder the
app made or the user picked, so the page has a "Pick a folder…" button (Google Picker, with shared
drives on). Picking fills in the parent; the probe then reads it, lists what the app can see in it
(expected: nothing it did not make), and creates `chordless-probe-…` inside it, as the team folder
would be. It needs, in the Google Cloud console, the Picker API enabled and a browser API key allowed
for it (restrict it to the Picker API and to the page's address); the key is typed on the page and
kept in that browser only (the Worker's `GOOGLE_API_KEY` is a different key and never reaches a
browser). The app id is the project number, `818185619377` (`chordless-app`). The production CSP is not changed yet:
it needs `apis.google.com`, `docs.google.com` and `www.gstatic.com` when the Picker goes in the app.
Needs one account; items 1, 5 and 6 still need two.

**Run 2026-10-19 on a picked shared-drive folder (spike item 2, owner's token): passed.** The Picker
folder reads as a shared-drive folder the app may add to, shows 0 items (`drive.file`), and a folder
made inside it takes create, list, get, update, download, subfolders, reading the permissions (3
people: the shared drive's members), making a file public and removing that, and `changes.list` (about
6 s behind). One failure found something real: a permanent delete does nothing for a Content manager,
so the one place the app deleted permanently (replacing a pad set's files) now trashes them
(`trashFilesInFolder`).

## Order of work and status

1. [ ] Principle in CLAUDE.md; this doc and the consolidation.
2. [x] Spike (above): passed, see "Spike results".
3. [ ] Space abstraction: space id + `rootRef` identity, folder-location Picker on create,
   shared-drive flags, no name matching, per-space transport. **The storage API (docs/STORAGE_API.md)
   is built:** the sync engine and share links work through `StorageBackend` / `SpaceStorage`, so
   per-space transport is a matter of which backend a space is given, and the team service (item 7) is
   another backend for it.
   Done: `supportsAllDrives` (and `includeItemsFromAllDrives` on listings) on every call on files in
   `drive-api.ts` and on the share download in the Worker (`allDrivesUrl`; tested against FakeDrive,
   and since checked against a real shared drive: spike 2 passed). The folder is already found by `rootRef`
   after the first sync. The Picker is built (2026-10-22: `folder-picker.ts`; its key is `PICKER_API_KEY` on the Worker, served at `/api/config`; the CSP is a first guess, not yet seen running). Not done: the space id and kind on the record, no name matching.
   The UI, code and docs say "space" (renamed from "organisation" on 2026-10-20).
4. [ ] Copy/move between spaces (an export and import, above, is built and does the hop between
   accounts) (songs, setlists, pads, whole space); migrate personal data.
   Done: the core for songs, setlists and whole spaces (`src/js/space-transfer.ts`, tested on local
   databases). A move leaves a setlist that is in Drive in the source (deleting those is not built).
   Not done: the UI, and pads (Drive calls).
5. [x] Read-only rework: gates removed, `syncsBack`, pull skips records with local changes, "differs
   from official" button with revert (setlists). Left: what-differs list, charts' marker, role from the Worker.
6. [ ] Per-space pads and the "Save to" upload choice.
7. [ ] Worker team service (serves the storage API to members; the API handler `worker/src/team-api.ts` and the client `TeamStorage` are built and tested on the in-memory storage, 2026-10-20; the identity check is built too (`worker/src/identity.ts`, below), and so is the Durable Object's state (`team-state.ts`, `team-space.ts`, 2026-10-21: owner, members and roles, the refs in the tree, the owner's blob) the owner-token source for Drive (`team-drive.ts`), the route (`router.ts`, `team-routes.ts`, `team-context.ts`), making a space, invites, joining and looking after the people (`team-admin.ts`); the join page (`/join#<space id>.<code>`, `team-join.ts`) is built, including for a link opened in the installed app (`launch.ts` hands the page the fragment of any link it is launched with, tagged with the path it came for: `incoming-link.ts`), and the Account and Teams page works for a member and has a Team Space panel (`team-share-panel.ts`): share the current space, invite by email (the link is shown once, to send), change roles, remove people, withdraw invites, stop sharing, or leave; the space list (`select-space.ts`, on the Account and Teams page) says which spaces are a team's and the role in each, and how one is joined; not yet the service account, the pads, or a switcher in the header): Durable Object, enable-sharing consent, invite/join/revoke, roles incl. admin,
   pad rules, no content persisted (a test asserts no storage writes of bodies).
8. [ ] UI: the team space wizard ("Creating a team space": name, where the files live, what to
   bring, invite, progress). **Built so far (2026-10-22): `/account/new` (`team-space-wizard.ts`) asks
   for the name and the parent folder, makes `<name>/` in it, registers it and offers to open it;
   "Share this space" is gone (the Team Space panel links to the wizard). What to bring (songs, setlists; not pads) and the invite step are built too. Not built:
   the shared-drive choice and the service account; header switcher (Separate), then Merged
   and the preference. Needs the Picker (item 3) and setlist deletion (SYNC_ARCHITECTURE.md) first.
9. [ ] Space-aware immediate sync in the service worker.
10. [ ] Team-managed storage: service-account provider, upgrade flow, deletion of the owner's token on
    switch, "Verify" and rollback. Spike item 7 passed.

Items carried over from the TODO (space section): a media-team email config option; define
users, leaders, permissions; join/invite/remove user; restrict editing others' setlists by `ownerId`
(see SYNC_ARCHITECTURE.md).

## Where work stopped (2026-10-21)

Built and committed, all verified against fakes (fake Drive, in-memory storage, workerd for the
Durable Object) and never against a real deployed Worker, a real Google sign-in or an installed app:

- Identity: the Google ID token as the per-request proof, behind `IdentityProvider`; members are keyed
  by `provider:sub`. Sign-in without Drive; `connectDrive()` adds `drive.file` later.
- The Durable Object per team space; the owner-token credential; the storage API for members;
  `TeamStorage` on the client; making a space, invites (bound to one email, single use, 7 days),
  joining, roles, leaving, ending sharing.
- Pages: `/join`, the Team Space panel on the Account and Teams page, and the space list showing kind and role.
  The installed app hands the fragment of any link to the page (`incoming-link.ts`).

**Not built**, in the order I would take them:

1. **A real-account run first.** Expect surprises in Google's consent screen, the Durable Object
   migration `v1` on the first deploy, and Drive permissions on the owner's folder. Two accounts, one
   installed app.
2. Service-account credential (item 10), so a shared drive needs no owner token.
3. Pads in team spaces (item 6).
4. ~~Share links from a team space~~ (built 2026-10-22, tested on fakes: the team service passes
   `publicLink` for shares and `unpublish` through to the owner's Drive; check on the real run).
5. A switcher in the header, then Merged and Separate (item 8).
6. Probing protections: unguessable or signed space ids, per-account rate limits, key rotation
   (SECURITY.md).
7. ~~The personal-space notice~~ (built); a toast after sign-in for "Drive not connected" is left, and may not be needed.

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
Merged/Separate with 1 vs 2 spaces (switcher hidden with 1); the Worker never persists bodies.
Manual two-account run for the spike and the team-service and UI steps. Log real defects in
`docs/test-catches.jsonl`.

# Spaces

The single home of the space model: what a space is, where its data lives, who may do what, how
people are invited, how data moves between spaces, and how read-only works. Share links (one
setlist sent to people without an account) are in SHARING.md. How sync itself works is in
SYNC_ARCHITECTURE.md.

> **Status:** the personal space and the single-user sync described under "Today" are built. The
> team space, the Worker broker, roles, copy/move and the rest are **designed, not built**; the
> order of work and a status list are at the end. In code, identifiers and some older docs still
> say "organisation": that is a space (see "Naming").

## Principle

**Chordless never stores copyrighted content; it only brokers access to it.** Charts, lyrics and pad
audio live in the user's own browser and in a Drive the user (or their team space's owner) controls.
The Worker passes team-space traffic through (streamed, never buffered to storage) without
persisting or caching it: no KV, R2, Durable Object or Cache API entry may hold song, setlist or pad
content. They hold only membership, roles, the owner's encrypted token blob and checksums. (Share
links are the one exception: the Worker caches ciphertext it cannot read.)

Churches using Chordless are expected to hold a CCLI licence, which covers sharing charts with the
members of their church. Each space is self-contained, so copyright compliance is per space.

## Naming

- The umbrella word is **space**, and there are two kinds: a **personal space** (yours alone, in
  your own Drive) and a **team space** (shared, brokered). "Create a team space", "Join a team
  space", "Save to: Personal space / Grace Church (team space)". The word "organisation" goes from
  the UI, and from code and docs as they are touched.
- Each space also has its own name (a team space is named by its owner; the personal space defaults
  to the account name, as `first-time-auth.ts` does today). The kind shows as a small label beside
  the name, and only when the user has more than one space.
- Not "Personal Library": the Library page (`/songs`) is the song list and every space has its own,
  so keep "Library" for the page only.

## The model

A space is a local IndexedDB plus a Drive folder; what changes between the kinds is who owns the
folder and how data reaches Drive.

| | Personal space | Team space |
|---|---|---|
| Drive folder | `Chordless/` in your My Drive, as now. No picker. | **Chosen by the owner** with the Picker: any folder in My Drive or a shared drive. No hard-coded path. |
| Identity | the folder named `Chordless` | server-issued space id; folder found by stored `driveFolderId`, never by name |
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
(API key, app id `376758830135`, CSP for `apis.google.com`, `docs.google.com`, `www.gstatic.com`).

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
- localStorage caches the current space's id (`current-organisation-id`) and name
  (`current-organisation-name`) for synchronous rendering.
- On first load a default space named "Personal" is created and made current. On a first Google
  sign-in, a space still called "Personal" is renamed to the user's name (metadata only).
- Spaces are completely isolated: songs and setlists belong to exactly one; switching reloads the
  app on the other database; a setlist references only its own space's songs; the same CCLI song in
  two spaces is two separate instances.

### Finding the Drive folder

- The first sync on a device finds the folder **by name** (so a new device joins an existing
  space) and stores its id on the space record (`driveFolderId`). Later syncs use the id, so a
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
permissions) plus the signed-in user, who is the default for new setlists. With the broker, the
member list comes from the Worker instead.

### Sign-in model

The Worker keeps no per-user state (until the broker adds its Durable Objects).

- **Signing in:** Google sign-in (GSI) runs in a popup, and the page posts the code and ID token to
  `/oauth/callback`. The Worker verifies the ID token, exchanges the code for tokens, encrypts the
  refresh token into a JWE blob (AES-256-GCM, with a `kid` for key rotation) and returns the blob,
  an access token and the user's profile.
- **The blob** is stored by the service worker in the `auth` IndexedDB. Pages get access tokens by
  messaging it.
- **Expired access tokens:** the service worker refreshes them with `/session/refresh`. The Worker
  decrypts the blob only for that request.
- **Expired sign-in:** when Google answers `invalid_grant` to a refresh (the refresh token expired
  or was revoked; it dies after 7 days while the consent screen is "Testing"), the Worker answers
  `401 invalid_grant` and the client throws `SignInExpiredError`. `getSignInState()` is
  `signed-out`, `signed-in` or `expired`; only Google's refusal makes it `expired` (no network, or
  any other failure, counts as signed in). The Storage page then says "Sign-in expired", offers
  "Reconnect with Google", and disables the sync panel with the reason.
- **Scope:** `drive.file openid email profile`. Drive access is limited to files the app created
  (or the user picked with the Picker).

## Why the Worker brokers (verified 2026-10-13, real second account)

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

**The design:** the Worker brokers the owner's access.
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
2. Show the service-account address and the exact role to grant (Content manager; Contributor can't
   delete, so pad delete rules would be Worker-only).
3. "Verify" makes the Worker test read/write/delete with the service account.
4. The Worker switches that team space's transport to the service account and **deletes the owner's
   stored token blob** (which also removes the broad personal token from the Durable Object).
5. Rollback by re-adding an owner token. Members' experience doesn't change.

**Restrictions:** the account can only reach what was shared; recommend a dedicated shared drive for
Chordless (a shared drive's membership is drive-wide, not per folder, so "least privilege" means "a
drive of its own"). The Worker also checks every call's target is inside the team's `driveFolderId`
tree (the owner-token path needs the same check).

**Operator choice, recommended: one Chordless-operated service account** (key in a Worker secret,
never in KV/DO, rotatable) so teams just share a drive and paste nothing. The credential provider is
looked up **per team** (`credentialFor(teamId)`), so one account per team can follow without
redesign. Not now: per-team accounts need Chordless to hold a key-minting credential (IAM Service
Account/Key Admin) and many keys in Durable Objects under one master secret, so a Worker compromise
still reaches them all; they'd mainly help against a single leaked key, per-team revocation, audit
clarity and per-identity rate limits (Google's 100-accounts-per-project default is a further limit).
Revisit with many teams or if the spike shows rate limits bite. Also not built: bring-your-own
service account (the team uploads its own key; isolation, but real setup friction for a church).

Roles, pads and conflicts are identical in both modes (the Worker enforces them either way); only
the credential provider behind the transport differs. Build the owner-token path first and slot the
service account in as a second provider.

## Roles

owner (implicitly admin) > admin > writer > reader. Worker enforcement:
- **Read** songs/setlists/pads: all members.
- **Write** songs/setlists: writer and up.
- **Upload pads: any member**, readers included (create-only, `pads/` folder only).
- **Delete pads: admin and up.** Delete songs/setlists: writer and up (friction/confirm in the UI,
  per CLAUDE.md "friction not prohibition").
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
  badged/grouped by space; the library already merges (`other-songs.ts`). New setlist uses a default
  space (last used, changeable).
- **Separate:** one active space, header switcher, everything scoped to it (today's model, with the
  switcher moved from the Storage page to the header).
- A setlist belongs to exactly one space and references only that space's songs.

Ship Separate first (mostly today's code: `getCurrentDB()`, switch = reload). Merged needs setlist
routes to resolve a space from the id and views to query several databases.

**Creating a setlist.** The form always says which space it is created in (a header line "New
setlist in Grace Church", plus the kind label when you have more than one space). With one place to
save there is nothing to choose. With more than one (Merged), it is a "Save to" field pre-filled
with the last one used, offering only places you can write to; in Separate mode it is the active
space, read-only text. A wrong choice is fixed with "Move to…" (keeps the setlist id).

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
- **Migration:** create the new team space (pick an empty folder on the shared drive), then move
  personal → team: songs, setlists, pads. The personal space is then empty and stays as the place
  for private sets. The same tool serves succession, handing over or splitting a team space.
- Copying out of a team space into your personal space is allowed for any member (it is local data
  in Drives they control). The library's "Add to my library" for a song from another database is
  the one-song version.

## Read-only: local edits are never blocked

**Built (2026-10-19).** A user who can only read the Drive folder edits everything a writer does:
the `isReadOnlyOrganisation()` gates are gone (setlist page, library, home, imports, nav menu, the
key and BPM controls). The one boolean left is `syncsBack()` (`organisation.ts`), and it removes
only what needs Drive: sharing by link (the song list to paste stays).
- The trigger is still Drive's folder `capabilities` or a refused upload (`refreshAccess()`,
  `organisation-access.ts`), kept as `readOnly` on the space record and in localStorage. Under
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
  Storage page is its revert.
- The toast says what the leader's version has that theirs did not (`sync/setlist-diff.ts`: songs
  added and removed, a different order, a key or tempo, the details) and offers **Undo**, which puts
  their version back (still never uploaded). Undo lasts as long as the toast (15 seconds).
- **No guard for a setlist that is open or live, on purpose.** A leader's last-minute song must reach
  a live follower: blocking it would go against "permissive in the moment". Today it cannot happen
  mid-service anyway, because a sync only runs when the user presses it on the Storage page. When
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

## Sync: what differs per space

- **Transport per space** (the `setAccessTokenProvider` seam): personal/owner → googleapis with the
  own token; member → `/api/space/<id>/drive/...` with their Google ID token. One engine
  (`drive-sync.ts`, `sync/*`).
- **Conflicts:** personal spaces are single-writer: keep Drive wins plus a conflict copy of dropped
  local edits. Team spaces add the Worker checksum precondition (409) and a Durable Object per space
  to serialise writes (SYNC_ARCHITECTURE.md).
- **Owner goes direct**, so it works if the broker is down.
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
   the owner's files (confirms the broker is required) and a new owner token cannot adopt the
   folder (confirms succession = copy).
7. **Service account:** in a shared drive, a Chordless service account added as Content manager can
   create, list, read, update and delete files and folders (`supportsAllDrives`); the Worker can
   mint its access token (RS256 JWT signed with WebCrypto, exchanged at Google's token endpoint)
   with no user present; it can reach nothing that wasn't shared with it; and an external service
   account can be added at all under a typical Workspace sharing policy. Also confirm shared drives
   are available on the nonprofit Workspace tier, and that a free Gmail user cannot create one (so
   owner-token stays the default path).

If 1 or 2 fail, stop and rethink (fallback: team folder only in the owner's My Drive).

**Ready to run:** `/dev/shared-drive-probe.html` (served by `just serve`, signed in on the Storage
page) makes a folder, then creates, lists, gets, updates, downloads, reads permissions, batch
deletes and trashes with the app's own `drive-api.ts` calls, and also tries `/about` with the flag.
Empty parent: your My Drive (checks the flags do no harm to everyone's sync). A folder id in a shared
drive is spike item 2, but under `drive.file` the token only sees a folder the app made or the user
picked, so it needs the Google Picker first (not on the page yet): without it, a refusal on the first
step is the scope, not the flags. Needs one account; items 1, 5 and 6 still need two.

## Order of work and status

1. [ ] Principle in CLAUDE.md; this doc and the consolidation.
2. [ ] Spike (above).
3. [ ] Space abstraction: space id + `driveFolderId` identity, folder-location Picker on create,
   shared-drive flags, no name matching, per-space transport.
   Done: `supportsAllDrives` (and `includeItemsFromAllDrives` on listings) on every call on files in
   `drive-api.ts` and on the share download in the Worker (`allDrivesUrl`; tested against FakeDrive,
   **not yet against a real shared drive**: spike 2). The folder is already found by `driveFolderId`
   after the first sync. Not done: the space id and kind on the record, the Picker, no name matching.
   The UI now says "space" (Storage page, creating and switching, sync errors, the share and differs
   dialogs); code, tests' identifiers and older docs still say "organisation".
4. [ ] Copy/move between spaces (songs, setlists, pads, whole space); migrate personal data.
   Done: the core for songs, setlists and whole spaces (`src/js/space-transfer.ts`, tested on local
   databases). A move leaves a setlist that is in Drive in the source (deleting those is not built).
   Not done: the UI, and pads (Drive calls).
5. [x] Read-only rework: gates removed, `syncsBack`, pull skips records with local changes, "differs
   from official" button with revert (setlists). Left: what-differs list, charts' marker, role from the Worker.
6. [ ] Per-space pads and the "Save to" upload choice.
7. [ ] Worker broker: Durable Object, enable-sharing consent, invite/join/revoke, roles incl. admin,
   pad rules, no content persisted (a test asserts no storage writes of bodies).
8. [ ] UI: Spaces section (create, join, members, invite), header switcher (Separate), then Merged
   and the preference.
9. [ ] Space-aware immediate sync in the service worker.
10. [ ] Team-managed storage: service-account provider, upgrade flow, deletion of the owner's token on
    switch, "Verify" and rollback. Gated on spike item 7.

Items carried over from the TODO (organisation section): a media-team email config option; define
users, leaders, permissions; join/invite/remove user; restrict editing others' setlists by `ownerId`
(see SYNC_ARCHITECTURE.md).

## Risks

- Consent screen must be "In production" or refresh tokens die in 7 days.
- The Worker carries team-space traffic including pad audio (cost, limits).
- Owner-token mode: the owner leaves or revokes and sync stops; succession is a copy. (Solved by
  team-managed storage for teams on a shared drive.)
- A Chordless-operated service account concentrates risk: one leaked key reaches every team that
  shared a drive with it. Keep it in a Worker secret, rotatable, and scope every call to the team's
  folder tree.
- Workspace accounts and shared-drive admin policies are untested (spike 2).
- A consent-screen/verification change, or Google restricting `drive.file` further, would undermine
  the whole broker design.

## Tests

`just format lint test` after each step. Worker broker tests use `fake-auth-worker.ts` /
`fake-drive.ts` extended with a second user and shared-drive flags. To cover: create a team space
with a chosen parent; enable sharing; join; reader edits stay local and survive a pull; reader can
upload but not delete pads; admin can delete; move personal → team keeps setlist ids and moves pads;
Merged/Separate with 1 vs 2 spaces (switcher hidden with 1); the Worker never persists bodies.
Manual two-account run for the spike and the broker/UI steps. Log real defects in
`docs/test-catches.jsonl`.

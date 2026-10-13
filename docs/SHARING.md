# Sharing

Chordless has two kinds of sharing:

1. **Organisation sharing** (permanent): the organisation's Drive folder is shared
   with the people in the worship team, so their devices sync the same setlists and
   songs. Exists today, set up by hand in Google Drive.
2. **Share links** (temporary): one setlist, with its charts, sent as a link to
   people who may have no account. Built (see "Status" in Part 2). Replaces the earlier
   link sharing (`share.html`, `share-setlist.js` and the worker's `/api/share`),
   which only sent song ids and never worked.

Sync itself is described in SYNC_ARCHITECTURE.md.

## Licensing and why links expire

Churches using Chordless are expected to hold a CCLI licence, and to share charts
with members of their church, which the licence covers. Chordless never hosts charts
itself: they live on devices and in the church's own Google Drive.

Share links put charts behind a public URL, so the risk is not the church's use but
a crawler finding a link and a copyright takedown notice following. Two defences:

- **Encryption:** the shared file is encrypted, and the key is only in the part of
  the link after `#`, which browsers never send to a server. The file alone is
  useless to anyone who finds it.
- **Expiry:** if a full link does leak, it stops working two weeks after the
  service.

---

## Part 1: Organisation sharing

### Today

- Each organisation is a folder `Chordless/<organisation>/` in the owner's Drive.
- The owner shares it with team members in the Google Drive UI.
- At each sync the app lists the folder's permissions and caches them on the
  organisation record (`members`). The setlist form's Leader list comes from there.

### Planned

- **Invite dialog:** share the organisation folder with an email address, as read
  (musicians) or write (leaders) access. The worker's `/session/invite` and
  `/session/revoke` were written for this and are unused.
- **Shared users can't find the folder yet.** The app has only the `drive.file`
  scope, which covers files the app created for that user, so a member's device
  can't see a folder shared with them. Needs the Google Picker (the user picks the
  folder once, which grants access to it) or a wider scope.
- **Restrict edits to a setlist's leader**, using `ownerId`.

---

## Part 2: Share links

### Status

Built: the bundle and encryption (`share-bundle.ts`, `share-crypto.ts`), making, updating and
ending a share (`share-manager.ts`, called by a sync step in `DriveSyncManager.sync()`), the
share button in the header of the setlist overview (`setlist-share.ts` is the modal it opens: the explanation and Create, or the link, QR code, Update and Stop; the button is lit while shared), the worker's
download and preview (`worker/src/share.ts`, `share-page.ts`), and opening a link
(`share-receiver.ts`, `views/share-view.ts`, route `/s/<id>`). Not done:

- Importing a received set's songs into a library (the TODO).
- Per-device view settings on a received set (a key change there is lost when the set updates).
- Trying it on a Workspace account, and a real run with several people (see "Still to check").

### Goals

- A leader shares one setlist, with all its charts, as a short link or QR code.
- Recipients need no account: they open the link and see the set, read-only.
- The setlist and charts are kept on the recipient's device apart from anything
  else (no organisation, never mixed into a library), so the set still works offline
  at the service.
- **One link per setlist, updated in place.** Adding a song, changing a key or
  fixing a chart updates what recipients see, without sending a new link.
- Expires two weeks after the setlist's date: the file in Drive and the copies on
  recipients' devices.
- No server state: the encrypted file lives in the church's Drive.

### Overview

```
Leader's device                     Church's Drive                   Recipient's device
---------------                     --------------                   ------------------
setlist + charts
  → bundle (JSON)
  → compress, encrypt (key K)  →    <org>/shares/<setlistId>.share
                                    (anyone with the link can read,
                                     not discoverable)
setlist.share = {fileId, K, …}
  (synced in the private
   setlist file)

link: https://chordless.app/s/<fileId>#<K>  ───────────────────→   fetch file (API key,
                                                                     no sign-in),
                                                                     decrypt with K,
                                                                     store in its own
                                                                     IndexedDB, show it
```

### The bundle

What's encrypted. Everything a recipient needs, and nothing about the organisation:

```json
{
  "format": "chordless-share",
  "version": 1,
  "expires": "2026-10-25",
  "updated": "2026-10-09T19:30:00Z",
  "setlist": {
    "date": "2026-10-11",
    "time": "10:30",
    "type": "Church Service",
    "name": "",
    "owner": "Ann Smith",
    "songs": [{ "title": "…", "key": "A", "notes": "…", "chordpro": "{title: …}…" }]
  }
}
```

- The chart text is included, not song ids.
- Not included: organisation ids, Drive ids, leaders' emails (`ownerId`) and sync
  fields.
- A typical setlist (4–6 songs) is 10–15 KB of ChordPro, about 3–4 KB compressed.

### Encryption

All browser-native: `CompressionStream` and Web Crypto.

1. Serialise the bundle to JSON and compress it (`CompressionStream('gzip')`).
   Compress before encrypting: encrypted data doesn't compress.
2. Encrypt with AES-GCM, using a random 128-bit key and a fresh random 12-byte IV
   on every upload.
3. The file is the IV followed by the ciphertext.

The key is created when a setlist is first shared, and kept for the life of that
share. It's written into the link as base64url, without padding (22 characters).

### Where things are stored

**The share file:** `<org folder>/shares/<setlistId>.share`
- Its permission is `anyone` with `role: reader` and `allowFileDiscovery: false`,
  so it can be read by anyone with its id but doesn't appear in searches.
- Only this file is public. The `shares` folder and the organisation folder stay
  private.
- Its `appProperties` are `setlistId`, `organisationId`, `expires` and `appVersion`,
  generated in `drive-metadata.js` like all other Drive metadata. They're readable
  by anyone with the file id, so they must never include the key.

**The key:** on the setlist, as
`setlist.share = { fileId, key, expires, bundleHash }`.
- The setlist file is private to the organisation. Anyone who can read it can
  already read the charts, so storing the key there exposes nothing new.
- **Any leader's device can show the link again, update the share or stop it**,
  not just the device that created it.
- `bundleHash` is a hash of the unencrypted bundle that was last uploaded. Sync uses
  it to tell when the share needs updating.

### Expiry

`expires` = the setlist's date + 14 days, or the share's creation date + 14 days if
that's later (a set shared after its date). It's recalculated if the setlist's date
changes.

It's enforced in three places:
1. **Sync** revokes the public permission of expired share files and trashes them (see Sync below).
2. **Recipients** delete the setlist once it's past `expires` (its songs stay: see "Shared with me").
3. **Recipients** delete the setlist if the file is gone, so the fetch returns
   404.

Expiry depends on someone in the organisation syncing. A file nobody cleans up stays
in Drive, but it's still encrypted, so it's useless without the full link.

### Sharing (sharer's UI)

- **Where:** a Share button on the setlist, for signed-in users with write access to
  the organisation folder.
- **Not shared yet:** "Create share link". This builds the bundle, creates a key,
  uploads the file, sets the permission and saves `setlist.share`. It needs to be
  online.
- **Already shared:** shows the link, a **QR code** for sharing in the room, Copy,
  native share (`navigator.share`), the expiry date and "Stop sharing".
- **"Stop sharing"** revokes the public permission (that is what ends access: trashing alone
  does not), trashes the file and clears `setlist.share`. It's
  outward-facing and ends people's access, so it asks for confirmation. Sharing again
  afterwards creates a new key and file, so old links stay dead.
- **QR code:** browsers have no built-in QR generator, so this needs a small library,
  vendored into `src/vendor` like Lit.

### Sync

Two new steps in `DriveSyncManager.sync()`, after setlists and songs are pushed:

1. **Update shares.** For each setlist with an unexpired `share`:
   - Rebuild the bundle and hash it.
   - If the hash differs from `bundleHash`, re-encrypt with the same key and a new IV,
     and update the same Drive file with `updateFile`. The link doesn't change.
   - Save the new `bundleHash`, and `expires` if the date changed.

   The bundle changes when songs are added, removed or reordered, when a key or note
   changes, and when one of its charts is edited.
2. **Clean up shares.** List `shares/`, and revoke the public permission of, and then move to the Drive trash, every file whose
   `expires` has passed, or whose setlist doesn't exist or has no `share` pointing at
   it. Clear `share` on setlists whose share expired.
   - Trash, never permanent deletion, as for everything the app removes.
   - Any leader's sync can do this, not just the sharer's.

Later:
- **Immediate background sync** (SYNC_ARCHITECTURE.md Part 2) pushes share updates
  moments after a change.
- **Scheduled sync** would make cleanup more regular. Periodic Background Sync only
  exists in Chromium-based browsers, for installed apps, so until then cleanup runs
  whenever someone opens the app and syncs.

### Opening a link (recipient)

The link is `https://chordless.app/s/<fileId>#<key><code>`, about 70 characters. The `<code>` is 6
characters, the first 32 bits of the sharer's setlist id (a UUID), in base64url. Someone who has
that setlist in their current organisation is taken to it at once (`replace`), with no download;
the code is short, so a clash would only open another of their own setlists. Anyone else opens
the share with the key. (The file id has to be Drive's own: Drive won't take ids we choose.)

The service worker routes
`/s/*` to the share page.

1. Download the file from the worker: `GET /api/share/<fileId>`. No sign-in needed. It returns
   the ciphertext and an `ETag`; send it back as `If-None-Match` to learn cheaply whether
   anything changed (304). See "The download proxy".
2. Decrypt with the key from the link and decompress.
3. Check the format. If it's past `expires`, show "This share has ended" and keep
   no setlist.
4. Store it in the **"Shared with me" database** (`shared-with-me`), apart from any
   organisation: one `ChordlessDB`, local only (never synced), holding the received setlists
   (id `share-<fileId>`) and their songs, as an organisation's does, so the setlist page can
   show them. The setlist's `received` field holds the key, `ETag`, `expires` and `setlistId`, so
   `/s/<fileId>` works again on that device without the fragment. Songs are reused when the
   device already has that exact chart (by content hash); a changed chart is added as the new
   default of its song, and the earlier one stays as a variant.
5. Show it **read-only**, with the setlist page itself (given that database and
   `readOnly`):
   - no edit mode, and the info dialog has no edit or delete, and there is no share button
   - the overview says who sent it, with a link to what Chordless is
   - transposing and hiding chords work, as in any setlist

**Opening it again:**
- **Online:** ask the worker with the stored `ETag`. A 200 means it changed: decrypt and
  replace the local copy. A 304 means nothing did. A 404 means sharing stopped or expired: show "This share has ended" and
  delete the setlist (its songs stay).
- **Offline:** show the local copy.

**Tidying:** on every app start, and whenever the home page lists them
(`tidySharedWithMe`), delete received setlists that are past their `expires`, or that the
user now has in an organisation (below). The databases from before there was one
(`chordless-share-*`) are deleted. Songs are never deleted.

### Shared with me

Everything a user has seen should stay available to them. Setlists are temporary, songs are
not.

- **Where:** the `shared-with-me` database, a local-only organisation. Sync never touches it.
- **What's kept:** a received setlist lasts as long as its share. Its songs stay for good:
  a share ending, expiring or being replaced never deletes one.
- **Where it shows:** on the home page, as a "Shared with me" group of the current setlists
  (it only appears when there are some). For someone with no setlists of their own it is all
  there is, in place of the welcome card; otherwise it sits below their own.
- **Joining the organisation:** a share carries `setlistId`, the sharer's setlist id (a random
  UUID that gives no access to anything). When the user later joins that organisation and sync
  brings the setlist, an organisation setlist has the share's `setlistId`, and the received copy
  is deleted: they have the real one now, permanently. (Shares made before `setlistId` existed
  get one the next time the sharer's sync updates them.)

**Still to build:** search across the organisations' songs and "Shared with me" (the library
and add-song modal show one database today), and "Add to my library", which copies a song
from another database into the current organisation. A setlist can only point at songs in its
own organisation's database, so adding is always a copy: deduplicated by content hash, then
by the song's deterministic id, as a variant if the song is there in another form. It is up
to the user to add: a song with a CCLI number is covered by any church's licence anyway.
Explicit song deletion is separate: a synced song deleted only here would come back at the
next sync, so it waits for the Drive trash design planned for setlists
(SYNC_ARCHITECTURE.md). Songs received by link have no Drive copy, so those can be deleted
locally.

### The download proxy

Recipients don't fetch from Google. Google needs an API key for anonymous downloads, and
rate-limits them per IP: repeated bursts of downloads from one address got ours served a
"Sorry... automated queries" page (which has no CORS headers, so it shows up in a browser as
a CORS error). A room of people on one wifi opening a link looks the same. So
`worker/src/share.ts` serves `GET /api/share/<fileId>`:

- It fetches the file from Drive with the API key, which is a Worker secret
  (`GOOGLE_API_KEY`, in `.dev.vars` and `push-secrets.sh`) and never reaches a browser.
- It caches each answer at the edge for 60 seconds, so Drive sees about one request per file
  a minute however many people open the link. The cache is deliberately short, not matched to
  `expires`: updates must reach recipients, and a stopped or expired share must start giving
  404 (Drive does that once its public permission is revoked) within a minute.
- `ETag` is a hash of the ciphertext; `If-None-Match` gets a 304.
- **Only Drive's 404 means "ended".** Rate limits, error pages and unreachable Drive are 502,
  so a recipient keeps their local copy. Bad ids never reach Drive, and anything over 1 MB
  isn't relayed.
- It only ever sees ciphertext: the key is in the link's `#`.

### Security notes

- The key travels only in the link fragment and in the private setlist file. Google
  and Chordless's servers only ever see ciphertext.
- AES-GCM also detects tampering: a modified file fails to decrypt.
- The API key is created once, in the same Google Cloud project as the OAuth client, restricted
  to the Drive API. It only lets Google attribute quota to the project. It lives in the
  worker, not the client. Users never create one. Its HTTP referrer restriction is moot (the
  worker sends none): the Drive API restriction is the one that counts, and the key can be
  rotated.
- Anyone holding a full link can read the set until it expires or sharing stops.
  "Stop sharing" is the way to cut it off early.
- Recipients can keep what they've seen (screenshots, saved pages). Expiry is about
  links found later, not about trusting recipients.

### Verified against real Drive

Checked with `/dev/share-spike.html` (a personal Google account, a file in My Drive root):

- **Public permissions under `drive.file`:** the app can create `anyone`/`reader` with
  `allowFileDiscovery: false` on a file it created.
- **Downloading without sign-in:** `files.get?alt=media` needs an **API key**: with none,
  Google answers 403 "The request is missing a valid API key". With one it works from a
  browser, CORS included.
- **Updating in place:** the file id stays, `md5Checksum` changes, and anonymous readers see
  the new content immediately.
- **Burst:** 40 parallel anonymous downloads all returned 200, but repeated bursts then got the
  IP blocked for downloads (see "The download proxy"). Hence the proxy.
- **Trashing does not revoke access.** A trashed file is still downloadable by anyone with the
  link. To end access, **delete the `anyoneWithLink` permission, then trash the file**; after
  that an anonymous download is a 404. Stop sharing and expiry cleanup both do both steps.

Still to check:

- **Workspace accounts:** an admin can block sharing outside the domain. The share dialog
  then needs a clear error. Personal Google accounts are unaffected.
- **Creating the file in the organisation's `shares/` folder** (the spike used My Drive).
- **The proxy in production:** the Cache API behaves differently in `wrangler dev`.

### Tests

- **Unit tests:**
  - building a bundle from a setlist and its songs, with no organisation ids or emails
  - encrypting and decrypting round trip, and tampering failing
  - the expiry calculation
  - the bundle hash changing only when the content does
- **`fake-drive`:** binary uploads, `anyone` permissions (and their removal), and
  `anonymousDownload()`, which stands in for the worker: 200 while the permission is there
  (trashed or not), 404 once it is revoked.
- **Sync tests:**
  - update shares only when the bundle changed, keeping the same file id
  - clean up expired and orphaned shares, using trash only
  - a second leader's sync updates and cleans up another leader's share
- **Playwright:**
  - share a setlist, then open the link in a fresh browser context
  - change a key, sync, reopen: the recipient sees it
  - stop sharing: the recipient sees "ended" and the local copy is gone
  - a past `expires` deletes the setlist (not its songs) on start

Where the tests are: `share-bundle.node.test.ts`, `share-proxy.node.test.ts`,
`share-page.node.test.ts`, `share-drive.test.ts`, `share-sync.test.ts`,
`share-receiver.test.ts`, `setlist-share.test.ts` and `share.playwright.ts` (which stubs the
worker's download and blocks service workers; the offline path is in `share-receiver.test.ts`).

### Removing the old link sharing

- **Removed now:** `share.html`, `share-setlist.js`, the share button and dialog,
  and the `/share/<id>` route.
- **Also removed:** the worker's `POST /api/share` and `GET /api/share/:id`, and the
  `SETLISTS` KV binding (the old link sharing was never finished). The KV namespace itself
  is still in the Cloudflare account and can be deleted there.

---

## Appendix: sign-in model

The worker keeps no per-user state.

- **Signing in:** Google sign-in (GSI) runs in a popup, and the page posts the code
  and ID token to `/oauth/callback`. The worker:
  - verifies the ID token
  - exchanges the code for tokens
  - encrypts the refresh token into a JWE blob (AES-256-GCM, with a `kid` for key
    rotation)
  - returns the blob, an access token and the user's profile
- **The blob** is stored by the service worker, in the `auth` IndexedDB. Pages get
  access tokens by messaging it.
- **Expired access tokens:** the service worker refreshes them with
  `/session/refresh`. The worker decrypts the blob only for that request.
- **Scope:** `drive.file openid email profile`. Drive access is limited to files
  the app created.

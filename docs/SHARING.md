# Sharing

Chordless has two kinds of sharing:

1. **Organisation sharing** (permanent): the organisation's Drive folder is shared
   with the people in the worship team, so their devices sync the same setlists and
   songs. Exists today, set up by hand in Google Drive.
2. **Share links** (temporary): one setlist, with its charts, sent as a link to
   people who may have no account. Designed below, not built. Replaces the earlier
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
2. Encrypt with AES-GCM, using a random 256-bit key and a fresh random 12-byte IV
   on every upload.
3. The file is the IV followed by the ciphertext.

The key is created when a setlist is first shared, and kept for the life of that
share. It's written into the link as base64url (43 characters).

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
1. **Sync** trashes expired share files (see Sync below).
2. **Recipients** delete their local copy once it's past `expires`.
3. **Recipients** delete their local copy if the file is gone, so the fetch returns
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
- **"Stop sharing"** trashes the file and clears `setlist.share`. It's
  outward-facing and ends people's access, so it asks for confirmation. Sharing again
  afterwards creates a new key and file, so old links stay dead.
- **QR code:** browsers have no built-in QR generator, so this needs a small library,
  vendored into `public/vendor` like Lit.

### Sync

Two new steps in `DriveSyncManager.sync()`, after setlists and songs are pushed:

1. **Update shares.** For each setlist with an unexpired `share`:
   - Rebuild the bundle and hash it.
   - If the hash differs from `bundleHash`, re-encrypt with the same key and a new IV,
     and update the same Drive file with `updateFile`. The link doesn't change.
   - Save the new `bundleHash`, and `expires` if the date changed.

   The bundle changes when songs are added, removed or reordered, when a key or note
   changes, and when one of its charts is edited.
2. **Clean up shares.** List `shares/`, and move to the Drive trash every file whose
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

The link is `https://chordless.app/s/<fileId>#<key>`. The service worker routes
`/s/*` to the share page.

1. Download the file:
   `GET https://www.googleapis.com/drive/v3/files/<fileId>?alt=media&key=<API key>`.
   No sign-in needed. Also fetch `md5Checksum` (`fields=md5Checksum`).
2. Decrypt with the key from the link and decompress.
3. Check the format. If it's past `expires`, show "This share has ended" and keep
   nothing.
4. Store it in its own IndexedDB, `chordless-share-<fileId>`, apart from any
   organisation. Store the key and checksum there too, so `/s/<fileId>` works again
   on that device without the fragment.
5. Show it **read-only**, using the setlist page's components:
   - no edit mode, sync, library or organisation
   - transposing and hiding chords are fine, kept as per-device view settings that a
     refresh doesn't overwrite

**Opening it again:**
- **Online:** fetch `md5Checksum`. If it changed, download, decrypt and replace the
  local copy. A 404 means sharing stopped or expired: show "This share has ended" and
  delete the local copy.
- **Offline:** show the local copy.

**Local expiry:** on every app start, delete `chordless-share-*` databases past their
`expires`.

### Security notes

- The key travels only in the link fragment and in the private setlist file. Google
  and Chordless's servers only ever see ciphertext.
- AES-GCM also detects tampering: a modified file fails to decrypt.
- The API key is public by nature. Restrict it in Google Cloud to the Drive API and
  to chordless.app (HTTP referrer).
- Anyone holding a full link can read the set until it expires or sharing stops.
  "Stop sharing" is the way to cut it off early.
- Recipients can keep what they've seen (screenshots, saved pages). Expiry is about
  links found later, not about trusting recipients.

### To verify against real Drive before building

- **Public permissions under `drive.file`:** that the app can create an `anyone`
  permission, with `allowFileDiscovery: false`, on a file it created.
- **Downloading without sign-in:** that `files.get?alt=media&key=…` works for that
  file from the browser, CORS included.
- **Workspace accounts:** an admin can block sharing outside the domain. The share
  dialog then needs a clear error. Personal Google accounts are unaffected.
- **Rate limits** for unauthenticated, API-key downloads with a whole team opening a
  link at once.

### Tests

- **Unit tests:**
  - building a bundle from a setlist and its songs, with no organisation ids or emails
  - encrypting and decrypting round trip, and tampering failing
  - the expiry calculation
  - the bundle hash changing only when the content does
- **`fake-drive`:** add `anyone` permissions, unauthenticated API-key downloads and
  404s for trashed files.
- **Sync tests:**
  - update shares only when the bundle changed, keeping the same file id
  - clean up expired and orphaned shares, using trash only
  - a second leader's sync updates and cleans up another leader's share
- **Playwright:**
  - share a setlist, then open the link in a fresh browser context
  - change a key, sync, reopen: the recipient sees it
  - stop sharing: the recipient sees "ended" and the local copy is gone
  - a past `expires` deletes the local copy on start

### Removing the old link sharing

- **Removed now:** `share.html`, `share-setlist.js`, the share button and dialog,
  and the `/share/<id>` route.
- **Removed once the Drive checks above pass:** the worker's `POST /api/share` and
  `GET /api/share/:id`, and the `SETLISTS` KV binding. The KV namespace itself is in
  the Cloudflare account and would be deleted there.

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

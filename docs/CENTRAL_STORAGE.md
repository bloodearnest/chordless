# Central storage: churches, teams and content

**Status (2026-11-23): steps 1 to 3 are built and merged:** church and team administration (#298), D1 sync for Team setlists, people and pad-set metadata (#300), and current church-library song bundles in R2 (#305). No existing Team has been switched: the Drive and anonymous-share paths remain the live ones until step 8.

## Goal and model

Chordless will keep shared metadata in D1 and song content, source PDFs, pad audio and anonymous shares in R2. Devices retain the content needed offline. Google Drive sync will be retired after existing Teams move.

A **church** represents one CCLI licence holder. It owns a shared song library and has one or more **teams**, each with its own setlist history. Most churches will have one team. Personal use remains available without joining a church, locally or synced.

Songs are not copied between churches or personal libraries, except in the explicit personal-to-church promotion workflow below. A team's setlists use only songs from their own church's library. Teams in a church share that library. Replace the current space terminology and model with church and team where appropriate, preserving existing identities and links during migration.

## Promote a personal space to a church

A person can explicitly promote a personal space to a new church and choose which personal setlists to copy into its first team. Copy the songs referenced by those setlists into the church library and point the copied setlists at them. Offer an optional, initially unchecked choice to copy the whole personal library too. The original personal space, songs and setlists remain. This workflow is the explicit exception to the no-cross-library-copy rule; ordinary use and anonymous shares do not copy songs between libraries. Preserve song provenance, and carry each copied song's source PDFs and parse history across (step 9).

## Church records and authorization

D1 holds the church's name, CCLI licence information and other records needed to identify the church and current licence details. A church has a required name, country and city/town, and optional postcode and CCLI number. Licence details are a JSON document for posterity; its form is deferred pending research. Retain only current values.

Church membership grants access to its library and all teams’ setlists. Church-wide roles determine who may change shared data; followed teams control homepage visibility. The Worker checks authorization before reading or changing R2 objects; knowing an object key is insufficient. Local edits remain possible offline, including for someone who cannot write shared changes back.

## Song content and immutable PDFs

D1 retains the song index and existing song identities. R2 stores chart content needed in live use, which devices sync for offline use. A fresh device reads the index and retrieves available content. A missing file remains visible as missing without deleting its index entry.

A song's current content is one bundle holding its ChordPro and its MusicXML (the format is under Backend and sync). MusicXML is derived from the imported PDFs. One bundle per song means a ChordPro edit and a MusicXML edit to the same song conflict; that is accepted.

Store each song's source PDF separately from synced chart content: kept as it came in private R2. A song is imported in a single key, as ChordPro and PDF together, so its newest import is its PDF. Nothing is overwritten: each import is its own object, under a key that sorts newest first, so a mistaken import can be undone (the original may not be to hand to import again), and two imports at once are two objects, not a conflict. There is no history screen yet. Who imported it, how and when are the object's own metadata, not a table. What the Worker reads from it is the song bundle's MusicXML, not stored a second time. Fetch the PDF on demand, and exclude it from routine device sync. No source PDFs are currently stored. Plan a later bulk reimport to upload them without changing song identities.

Move pad audio to R2, scoped to the appropriate church or personal library.

## Backend and sync

For current church-library songs, store a versioned JSON bundle with `format: 1`, `chordpro` text and nullable `musicxml` text. D1 keeps the SHA-256 of the complete serialized bundle, current R2 reference and version. R2 object keys are content-addressed under the library and song id; membership checks, never the key, authorize reads and writes. Write the immutable R2 object before the conditional D1 update, so a failed or concurrent update can leave an unreferenced object. Do not delete it in the request; orphan collection belongs in later cleanup work. An identical bundle and metadata write is a no-op. PDFs and pads are not included in this bundle or this sync path.

Build an R2 storage backend behind the existing interfaces, extending them where song bundles, source PDFs, pad audio or shares need additional operations. Preserve the current offline, versioning and conflict behavior: edits commit locally first, pending changes survive offline use, and online delivery starts promptly. Test concurrent edits, interrupted uploads and reconciliation between D1 metadata and R2 objects. Conflicts are decided by the D1 version (a compare-and-swap); R2 objects are immutable, so there are no R2 conditional writes to map.

Use one shared bucket initially, with church-scoped keys and authorization. Record country and keep bucket selection behind the backend; defer EU/US jurisdiction routing and per-church buckets until there is a concrete need. A location hint is best effort; a jurisdiction restriction is a residency control. See [R2 data location](https://developers.cloudflare.com/r2/reference/data-location/).

## Infrastructure

Terraform (`infra/cloudflare`) makes every bucket and database, and nothing else does. `wrangler.toml` names them (`bucket_name`, `database_id`); wrangler only binds them and applies `migrations/`. Wrangler's automatic provisioning is not used: it listed a new binding as inherited on a Worker version that lacked it, and every deploy failed (code 10057). The deploy waits for the apply (`deploy.yml`: `needs: apply`), so a resource exists before a Worker that binds it. A step that needs a new bucket or database adds it to Terraform in the same PR. All are `prevent_destroy`, private, with no public access or custom domain. The apply token needs R2: Edit and D1: Edit. Development uses local R2 and D1, not remote ones.

## Anonymous sharing

Redesign anonymous sharing around an application-owned share ID and R2 storage, removing dependencies on Drive file IDs, public permissions and the Drive download proxy.

- A leader creates a link or QR code for a setlist. Recipients need no account and can read it and its charts offline after opening it.
- Keep the link stable when the shared setlist changes. Enforce expiry and stop-sharing through the Worker.
- Store share bundles without client-side encryption in private R2 objects. The Worker checks the status of an unguessable link before serving it.
- Keep received charts inside the view-only share. Remove or change “Add to my library” so a shared song cannot be copied into another church or personal library.
- End existing Drive-backed links during migration; leaders create new R2-backed links.

Define what an already downloaded offline copy can show after expiry or revocation becomes known.

## Implementation sequence: one deployable PR per step

Church and library identities (#294), library-owned song metadata (#295), and the church administration API (#296) are built. Each step below includes its schema, Worker, client and tests where needed; preserve the Drive path until the controlled cutover.

1. **Church and team administration.** Complete church creation with its first team, church-wide roles, invitations and the church admin console. Admins manage members and teams; deletion archives a team and its history. New members initially follow their invitation's team.
2. **Team setlists and account-wide preferences.** Add team-owned setlists with ordered song entries as a JSON document. Preserve offline behavior and conflict handling, enforce church-wide permissions and same-library song references, and sync followed-team choices.
3. **R2 song storage and library sync.** Implement the R2 backend and D1 library API together: upload and retrieve current song bundles, sync offline, enforce church and personal-library access and handle concurrent changes. Update the privacy page before shipping content storage.
4. **Source PDFs and server-side reading.** Store each song's PDF (every import kept, the newest is current), read its lead sheet in the Worker so the browser need not, and exclude PDFs from routine sync. The Worker side is built (a `PUT` that stores and reads, a `GET` that downloads the newest; 137 sheets of 79 to 211 KB read in 23 to 177 ms each in workerd, limit 1 MB). Still to do: the client upload, once a space is library-backed, and parser-failure telemetry; pdf.js leaves the client after the cutover (step 8). Bulk reparse of stored PDFs waits for a need.
5. **Personal space and overlays.** *(A setlist is owned by a team or by an account, one of the two, so a personal space can have them too: migration 0019. Personal spaces migrate first, beside the Drive sync, which stays until step 10. Built so far (5a): the Worker's routes for a person's own library (made on demand) and setlists, `PUT /api/account/library` and `GET` and `POST …/batch` on `/api/account/setlists`, with the Team setlists' versions and the rule that a setlist's songs are in the person's library; no client change yet.)* Give each account one synced personal space, preserve signed-out local use, and ask before combining local and account data. Sync signed-in personal overlays, keep anonymous overlays local, and handle church membership ending and resuming.
6. **Church-wide pads and anonymous shares.** Move pad audio and redesigned shares to R2. Use private objects and unguessable links, Worker-enforced expiry and revocation, daily cleanup, stable updates and offline viewing. Received charts remain inside the view-only share.
7. **Deletion, recovery and export.** Add 30-day recovery for songs, churches and accounts; retain the minimal church register after final deletion. Export church data and setlists with separate options for current ChordPro, latest PDFs and pads, excluding MusicXML and parse history. Backup and disaster recovery of D1 and R2 remain a separate TODO (R2 has no object versioning; D1 has Time Travel). Drive is not covered: export it by hand before the migration.
8. **One-off migration and cutover.** Move both existing Teams (one church: one licence holder, two teams) into one church and one library, preserve IDs, setlists and overlays, merge identical charts and retain differing variants. Verify D1 and R2 before switching, keep a recovery path and refuse stale writes from older clients. End Drive share links.
9. **Personal-to-church promotion.** Create a church from selected personal setlists, with optional whole-library copy, including source PDF and parse history. Keep personal originals; this is the explicit copy exception.
10. **Retire Drive sync.** After migration and client cutover, remove Drive-specific backends, credentials, references and compatibility paths. Google sign-in may remain.
11. **CCLI usage report.** Report usage across a church’s teams, including archived teams, defaulting to the last 12 months with a selectable date range.

The detailed decisions, including roles and deletion behavior, are in [CHURCH_TEAM_DESIGN.md](CHURCH_TEAM_DESIGN.md).

## Verification

Test church and team boundaries, roles, shared access to a church library and rejection of songs from another church or personal library. Test personal use separately.

Test multiple devices for first download, offline edits, reconnect, concurrent changes, interrupted uploads, deletion and recovery. Verify source PDFs are immutable, remain out of routine sync, can be fetched on demand, and retain their version and parse history.

Test anonymous shares without an account: create, update at the same link, expiry, revocation and offline viewing. Verify recipients cannot copy shared songs into another library.

Rehearse the one-off migration against representative Drive data, including missing files, pads and existing shares. Verify identities and content before switching, and exercise recovery and old-client behavior.

## Design work still needed

- PDF provenance and partial-update behavior. Collect unreferenced content-addressed song objects without deleting an object still used by a library row.
- Church member and team administration APIs and the admin console.
- Migration verification and recovery, and treatment of offline clients at cutover.
- Country-specific licence JSON and form, after further research.

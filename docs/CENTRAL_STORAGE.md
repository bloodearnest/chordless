# Central storage: churches, teams and content

**Status (2026-11-21): design.** D1 sync for existing Team setlists, people, song index and pad-set metadata is built through step 2d (#290). No Team has been switched. The church and team model, R2 storage and migration below are future work.

## Goal and model

Chordless will keep shared metadata in D1 and song content, source PDFs, pad audio and anonymous shares in R2. Devices retain the content needed offline. Google Drive sync will be retired after existing Teams move.

A **church** represents one CCLI licence holder. It owns a shared song library and has one or more **teams**, each with its own setlist history. Most churches will have one team. Personal use remains available without joining a church, locally or synced.

Songs are not copied between churches or personal libraries, except in the explicit personal-to-church promotion workflow below. A team's setlists use only songs from their own church's library. Teams in a church share that library. Replace the current space terminology and model with church and team where appropriate, preserving existing identities and links during migration.

## Promote a personal space to a church

A person can explicitly promote a personal space to a new church and choose which personal setlists to copy into its first team. Copy the songs referenced by those setlists into the church library and point the copied setlists at them. Offer an optional, initially unchecked choice to copy the whole personal library too. The original personal space, songs and setlists remain. This workflow is the explicit exception to the no-cross-library-copy rule; ordinary use and anonymous shares do not copy songs between libraries. Preserve song provenance and review applicable licence terms for this workflow.

## Church records and authorization

D1 holds the church's name, CCLI licence information and other records needed to identify the church and current licence details. A church has a required name, country and city/town, and optional postcode and CCLI number. Licence details are a JSON document for posterity; its form is deferred pending research. Retain only current values.

Church membership grants access to its library and all teams’ setlists. Church-wide roles determine who may change shared data; followed teams control homepage visibility. The Worker checks authorization before reading or changing R2 objects; knowing an object key is insufficient. Local edits remain possible offline, including for someone who cannot write shared changes back.

## Song content and immutable PDFs

D1 retains the song index and existing song identities. R2 stores chart content needed in live use, which devices sync for offline use. A fresh device reads the index and retrieves available content. A missing file remains visible as missing without deleting its index entry.

Evaluate packaging ChordPro and MusicXML together in one object. Decide its format and update granularity during backend design, including concurrent edits to different parts.

Store source PDFs separately from synced chart content. Each imported PDF is immutable. A different PDF creates a new source version; retain earlier versions and import history. Associate each source with its church and song, import details and parsed output. Fetch PDFs on demand for audit, reparsing or download; exclude them from routine device sync. No source PDFs are currently stored. Plan a later bulk reimport to upload and link them without changing song identities.

Move pad audio to R2, scoped to the appropriate church or personal library.

## Backend and sync

Build an R2 storage backend behind the existing interfaces, extending them where song bundles, source PDFs, pad audio or shares need additional operations. Preserve the current offline, versioning and conflict behavior: edits commit locally first, pending changes survive offline use, and online delivery starts promptly. Map R2 revisions and conditional writes to existing conflict handling. Test concurrent edits, interrupted uploads and reconciliation between D1 metadata and R2 objects.

Use one shared bucket initially, with church-scoped keys and authorization. Record country and keep bucket selection behind the backend; defer EU/US jurisdiction routing and per-church buckets until there is a concrete need. A location hint is best effort; a jurisdiction restriction is a residency control. See [R2 data location](https://developers.cloudflare.com/r2/reference/data-location/).

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
4. **Source PDFs and reparsing.** Store immutable PDFs separately, deduplicate identical uploads per song, retain parse results and provenance, and exclude PDFs from routine sync. Add on-demand download, admin reparsing, parser-failure telemetry and the background reparse job.
5. **Personal space and overlays.** Give each account one synced personal space, preserve signed-out local use, and ask before combining local and account data. Sync signed-in personal overlays, keep anonymous overlays local, and handle church membership ending and resuming.
6. **Church-wide pads and anonymous shares.** Move pad audio and redesigned shares to R2. Use private objects and unguessable links, Worker-enforced expiry and revocation, daily cleanup, stable updates and offline viewing. Received charts remain inside the view-only share.
7. **Deletion, recovery and export.** Add 30-day recovery for songs, churches and accounts; retain the minimal church register after final deletion. Export church data and setlists with separate options for current ChordPro, latest PDFs and pads, excluding MusicXML and parse history. Backup and disaster recovery remain a separate TODO.
8. **One-off migration and cutover.** Move both existing Teams into one church and one library, preserve IDs, setlists and overlays, merge identical charts and retain differing variants. Verify D1 and R2 before switching, keep a recovery path and refuse stale writes from older clients. End Drive share links.
9. **Personal-to-church promotion.** Create a church from selected personal setlists, with optional whole-library copy, including source PDF and parse history. Keep personal originals; this is the explicit copy exception.
10. **Retire Drive sync.** After migration and client cutover, remove Drive-specific backends, credentials, references and compatibility paths. Google sign-in may remain.
11. **CCLI usage report.** Report usage across a church’s teams, including archived teams, defaulting to the last 12 months with a selectable date range.

Review applicable CCLI and SongSelect terms for the hosting and sharing model. The detailed decisions, including roles and deletion behavior, are in [CHURCH_TEAM_DESIGN.md](CHURCH_TEAM_DESIGN.md).

## Verification

Test church and team boundaries, roles, shared access to a church library and rejection of songs from another church or personal library. Test personal use separately.

Test multiple devices for first download, offline edits, reconnect, concurrent changes, interrupted uploads, deletion and recovery. Verify source PDFs are immutable, remain out of routine sync, can be fetched on demand, and retain their version and parse history.

Test anonymous shares without an account: create, update at the same link, expiry, revocation and offline viewing. Verify recipients cannot copy shared songs into another library.

Rehearse the one-off migration against representative Drive data, including missing files, pads and existing shares. Verify identities and content before switching, and exercise recovery and old-client behavior.

## Design work still needed

- Song bundle format, PDF provenance and partial-update behavior.
- Church member and team administration APIs and the admin console.
- Migration verification and recovery, and treatment of offline clients at cutover.
- Country-specific licence JSON and form, after further research.

# Central storage: churches, teams and content

**Status (2026-11-21): design.** D1 sync for existing Team setlists, people, song index and pad-set metadata is built through step 2d (#290). No Team has been switched. The church and team model, R2 storage and migration below are future work.

## Goal and model

Chordless will keep shared metadata in D1 and song content, source PDFs, pad audio and anonymous shares in R2. Devices retain the content needed offline. Google Drive sync will be retired after existing Teams move.

A **church** represents one CCLI licence holder. It owns a shared song library and has one or more **teams**, each with its own setlist history. Most churches will have one team. Personal use remains available without joining a church, locally or synced.

Songs are not copied between churches or personal libraries, except in the explicit personal-to-church promotion workflow below. A team's setlists use only songs from their own church's library. Teams in a church share that library. Replace the current space terminology and model with church and team where appropriate, preserving existing identities and links during migration.

## Promote a personal space to a church

A person can explicitly promote a personal space to a new church and choose which personal setlists to copy into its first team. Copy the songs referenced by those setlists into the church library and point the copied setlists at them. Offer an optional, initially unchecked choice to copy the whole personal library too. The original personal space, songs and setlists remain. This workflow is the explicit exception to the no-cross-library-copy rule; ordinary use and anonymous shares do not copy songs between libraries. Preserve song provenance and review applicable licence terms for this workflow.

## Church records and authorization

D1 holds the church's name, CCLI licence information and other records needed to identify the church and maintain its licensing history. Support the licences a church holds rather than assuming a single licence number. Define what information is required and retained after deletion, and how corrections and licence changes are recorded.

Church membership and roles govern access to its library and content; team membership and permissions govern its setlists. The Worker checks authorization before reading or changing R2 objects; knowing an object key is insufficient. Local edits remain possible offline, including for someone who cannot write shared changes back.

## Song content and immutable PDFs

D1 retains the song index and existing song identities. R2 stores chart content needed in live use, which devices sync for offline use. A fresh device reads the index and retrieves available content. A missing file remains visible as missing without deleting its index entry.

Evaluate packaging ChordPro and MusicXML together in one object. Decide its format and update granularity during backend design, including concurrent edits to different parts.

Store source PDFs separately from synced chart content. Each imported PDF is immutable. A different PDF creates a new source version; retain earlier versions and import history. Associate each source with its church and song, import details and parsed output. Fetch PDFs on demand for audit, reparsing or download; exclude them from routine device sync. No source PDFs are currently stored. Plan a later bulk reimport to upload and link them without changing song identities.

Move pad audio to R2, scoped to the appropriate church or personal library.

## Backend and sync

Build an R2 storage backend behind the existing interfaces, extending them where song bundles, source PDFs, pad audio or shares need additional operations. Preserve the current offline, versioning and conflict behavior: edits commit locally first, pending changes survive offline use, and online delivery starts promptly. Map R2 revisions and conditional writes to existing conflict handling. Test concurrent edits, interrupted uploads and reconciliation between D1 metadata and R2 objects.

Evaluate separate EU and US buckets and whether a bucket per church is worthwhile. Compare residency, isolation, operational cost, limits and migration implications before choosing. A location hint is best effort; a jurisdiction restriction is a residency control. See [R2 data location](https://developers.cloudflare.com/r2/reference/data-location/).

## Anonymous sharing

Redesign anonymous sharing around an application-owned share ID and R2 storage, removing dependencies on Drive file IDs, public permissions and the Drive download proxy.

- A leader creates a link or QR code for a setlist. Recipients need no account and can read it and its charts offline after opening it.
- Keep the link stable when the shared setlist changes. Enforce expiry and stop-sharing through the Worker.
- Retain encrypted share bundles, with the key in the URL fragment.
- Keep received charts inside the view-only share. Remove or change “Add to my library” so a shared song cannot be copied into another church or personal library.
- End existing Drive-backed links during migration; leaders create new R2-backed links.

Define what an already downloaded offline copy can show after expiry or revocation becomes known.

## Migration and rollout

1. Design the church, team and personal models, permissions, church records and R2 backend. Build and test the backend and redesigned sharing with new data.
2. Prepare a one-off migration per existing Team, controlled by the owner. Create its church and team, preserving existing song, setlist and other relevant identities.
3. Move D1 metadata and R2 content together once the backend is ready. Verify before switching; retain the original Drive data and a recovery path until the move is confirmed.
4. Handle old clients explicitly so later Drive writes are not silently treated as current. End old Drive-backed share links and create new ones where needed.
5. Retire Drive sync and its configuration after existing Teams and supported clients have moved. Move personal use onto the new storage model.
6. Bulk reimport source PDFs later, keeping every imported source version and its provenance.
7. Continue account preferences, personal overlays, sync across teams and CCLI reporting as separate phases on the new model.

Update privacy information and the project's current prohibition on hosting copyrighted content before R2 storage ships. Review applicable CCLI and SongSelect terms for the hosting and sharing model.

## Verification

Test church and team boundaries, roles, shared access to a church library and rejection of songs from another church or personal library. Test personal use separately.

Test multiple devices for first download, offline edits, reconnect, concurrent changes, interrupted uploads, deletion and recovery. Verify source PDFs are immutable, remain out of routine sync, can be fetched on demand, and retain their version and parse history.

Test anonymous shares without an account: create, update at the same link, expiry, revocation and offline viewing. Verify recipients cannot copy shared songs into another library.

Rehearse the one-off migration against representative Drive data, including missing files, pads and existing shares. Verify identities and content before switching, and exercise recovery and old-client behavior.

## Decisions to settle in design

- Which church metadata and licence history must be recorded and retained.
- The relationship between church membership, team membership and roles.
- EU/US bucket selection and whether to use a bucket per church.
- Song bundle format, PDF download handling and partial-update behavior.
- PDF provenance and parser/version information needed to make reparsing auditable.
- Migration verification and recovery, and treatment of offline clients at cutover.

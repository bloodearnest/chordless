# Church and team model: migration design

This design refines [CENTRAL_STORAGE.md](CENTRAL_STORAGE.md); it is not a schema migration or rollout. The agreed product decisions are below. Technical design and a rehearsed migration are still required before changing production data.

## What exists

The current `teams` row represents the whole shared space: its identity (`space_id`), name, owner, Drive root and CCLI licence. Membership, invitations, file references and events are keyed to that id. D1's `space_songs`, `space_setlists`, `space_people` and `space_pad_sets` likewise belong to that same id. The device has a separate database for each space. Personal spaces remain separate from Teams.

This conflates a church's library and its team's history. Adding a second team requires a church identity and authorization boundary shared by the teams, and a distinct team identity for setlists. Simply creating another current Team would create another library, contrary to the agreed model.

## Proposed changes to the existing schema

Start from the tables and constraints in migrations `0011`–`0013`; this is a schema delta, not a replacement data model. Preserve the existing columns, JSON fields, validation, indexes and version guards unless a specific change below requires an equivalent update. In particular, a setlist song carries its own key, tempo, notes, annotations and JSON `extra`; its metadata must survive unchanged. Store the ordered song entries as a JSON document on `team_setlists`, preserving all entry metadata. Remove the separate setlist-song table after migration.

| Current | Proposal | Ownership / migration |
|---|---|---|
| — | `churches` | New church identity, required name, country and town, optional postcode and CCLI number, current licence JSON and minimal retained register. |
| — | `libraries` | Shared parent owned by exactly one church or one personal account; enforce exclusive ownership. |
| `teams` | `teams` | Add a church foreign key. Keep each existing `space_id` value as the team identity; rename the column to `team_id` when dependent relationships and routes can move together. |
| `space_songs` | Library-owned songs | Change ownership from team to the church or personal library; preserve song UUIDs and fields. Store R2 bundle references and source PDF / parse history on the song. |
| `space_setlists` | `team_setlists` | Team-owned; preserve IDs, fields, JSON `body`, unique setlist ID, date index and version guard. |
| `space_setlist_songs` | JSON document on `team_setlists` | Migrate ordered entries and all metadata, including `annotations` and `extra`; enforce that each referenced song belongs to the team's church. |
| `space_people` | Account-based church membership and historical leader names | Members are accounts; retain historical leader names even when an account is unlinked or no longer eligible. |
| `space_pad_sets` | Church-wide pad sets | Pad sets and audio belong to the church; existing pads may be dropped during the one-off migration. |
| `team_members`, `team_invites`, `team_events` | Church membership and invitations | Merge memberships using the highest existing role. Existing invitations may be dropped. Keep current licence details, not a licence-change log. |
| `accounts`, `account_identities`, `account_emails`, `sessions`, `login_codes` | Existing tables | Retain account and sign-in behavior. |
| `account_drive`, `team_refs`, `team_credentials` | Retire after migration | Drive credentials and file references remain until migration and supported-client cutover are complete. Review `teams.root_ref`, `credential`, `owner_provider`, `owner_sub` and `storage` at the same time; remove a field only after confirming no remaining dependency. |

Use `STRICT` tables and ULIDs for **new** identifiers. Existing team, song and setlist IDs remain unchanged opaque strings. Declare foreign keys with deliberate delete behavior and supporting indexes. Migration must carry existing JSON, defaults, checks and indexes forward, and retain the version guards in `0013` or their equivalent. Rehearse the real migration with production-shaped data and foreign keys enabled, as [SCHEMA_RULES.md](SCHEMA_RULES.md) requires.

R2 holds objects; the proposal does not assume separate R2 tables. A chart and PDF reference may be stored with the song, but a single PDF key alone does not establish the agreed history of multiple immutable source PDFs. Decide how versions, import provenance and parser history are represented before specifying columns. Anonymous shares will be redesigned without client-side encryption: unguessable share IDs and a private R2 object, served only after the Worker checks share status.

## Migration boundary

The one-off move creates one church and shared library for both existing Teams, preserves their team, song and setlist identities and relationships, and carries membership and current licence details forward. Keep existing space IDs as team IDs and existing setlist URLs; introduce church and library IDs, and map device data as described below. Migration must validate the mapping, preserve local changes and fail rather than guess if it cannot preserve data. Move metadata and R2 content together only after verification; retain Drive data and a recovery path until confirmed.

Songs belong to a church's library; multiple teams use that same library. Setlists belong to a team and reference only that church's songs. No operation copies songs across churches or personal libraries except the explicit personal-to-church promotion workflow below. Personal use remains possible without a church. Authorization must check the actual church or team, not merely a storage key or an identifier supplied by the client.

## Decisions: churches, libraries and migration

Church membership grants access to the church's song library. Use a shared `libraries` parent for church and personal libraries: a library belongs to exactly one church or one personal account, enforced by a database check. Songs belong to a library; teams belong to a church and use its library. A personal library does not require a fictitious church. The exact keys, foreign keys and uniqueness constraints must preserve existing song identities and meet [SCHEMA_RULES.md](SCHEMA_RULES.md).

A church requires a name, country and city or town; postcode or ZIP code and CCLI licence number are optional. An admin may change these fields, and only current values are kept. It also records a JSON document of the specific licences it holds, whose contents may vary by country. This information is for posterity, not automatic enforcement. Keep only the current licence number and licence details, not a separate licence-change history. Any church member may view them; only an admin may change them.

The one-off migration may drop existing anonymous shares, pads and invitations. **Preserve personal overlays** and their relationship to the correct user and setlist. An anonymous recipient's share overlays stay on that device and are never synced; this does not discard overlays belonging to signed-in users.

## Work to specify before implementation

The country-specific licence JSON structure and form are deferred pending research; retain the current CCLI number as a separate optional field. Specify the exact schema and API operations, account-based authorization for personal libraries, mapping of historical people and retained overlays, R2 object layout and cleanup, and failure handling for the migration. Rehearse the real migration against existing-shaped data as required by [SCHEMA_RULES.md](SCHEMA_RULES.md). Backup and recovery design is deferred in TODO.

## Existing Teams: one church

The owner confirmed that both existing Teams belong to the same church. A read-only inspection of the 2026-11-21 backup found two active Teams, both still on Drive, with the same owner account; one has a CCLI licence number and one has none. There are no D1 song, setlist, person or pad-set rows yet. The backup passes `foreign_key_check`.

The one-off migration therefore creates **one church and one shared library for both existing teams**, not one church per team. Preserve each existing `space_id` as its team ID, and retain song and setlist IDs. Merge identical charts from both Drive libraries into the one church library, retaining different charts as variants and preserving setlist references. Preserve overlays. Carry forward the recorded current licence; the missing number on the other Team is not evidence of a different church. Verify the source data and resolve any collisions explicitly before switching either Team.

Each device migrates its own current space databases after updating, independently of the server cutover. Preserve each team's setlists and overlays, and consolidate accessible song data into the church library without losing local edits. The local migration must be restartable and must not remove source data until the consolidated library is verified. Preserve existing setlist URLs by resolving their IDs to the team and church library. Existing anonymous share links and live rooms can end. New routes name churches, libraries and teams; old clients must update before cutover and old write routes must refuse stale writes rather than silently accepting them. Remove compatibility routes only after supported clients have moved.

## Agreed roles, people and pads

Church members may read every team's setlists and the shared church library. Worship leaders and admins may add and change songs; only admins may delete a whole song. Other teams' setlists do not appear on the homepage solely because of church membership; following or belonging to a team controls homepage visibility, not read access.

Collapse owner and admin into church admin, alongside worship leader and church member. Any church admin can manage other admins; the last admin must appoint another before leaving or removing their own admin role. Worship leaders and admins may update or delete any team’s shared setlists; deletion requires confirmation. Everyone can still make local personal changes.

Setlist leaders are church members with the worship leader or church admin role. Preserve historical leader names without linked accounts; choosing or changing a leader requires an eligible account; editing another field leaves an existing historical name untouched. Pad sets and audio are church-wide; personal use keeps its own pads.

After a church ends or is deleted, keep a minimal register of its name, country, city and current licence details for posterity; delete members, songs, setlists and other content. Specify the retention and deletion details before implementation.

## Further decisions

Followed teams are an account-wide preference that syncs across devices. A new church member initially follows the team named by their invitation, and can change that selection. Church membership grants read access to all teams regardless of homepage selection.

Worship leader is a church-wide role. A worship leader or church admin can be chosen to lead a setlist for any team, and can edit or delete any team's shared setlists. Deletion requires confirmation. Church members may make personal changes without changing the shared setlist. This supersedes the earlier leader-only control rule and the creator fallback for shared updates and deletions; it may be revisited later. Worship leaders and admins may add or change library songs; only admins may delete a whole song.

Only church admins may create or delete teams. Deleting a team archives it: hide it from normal use, retaining its setlists for church history and CCLI reporting.


## Further storage and sharing decisions

Use one shared R2 bucket initially, with church-scoped keys and authorization on every request. Record church country; defer EU/US routing until there is a concrete need. Keep bucket selection behind the storage backend. Migration combines existing members into one church and takes the higher existing role where they differ.

A song keeps a JSON array of source entries. Source PDFs and each successful MusicXML parse result are immutable. Compare PDF content hashes within that song: uploading an identical PDF is a no-op, without another object or entry. A successful reparse of the current source that passes basic checks becomes current automatically; failures leave the current MusicXML unchanged. Preserve successful parse results and their parser provenance. Two concurrent reparses retain their results, and the current pointer uses the existing version check. PDF reparsing does not change ChordPro. Preserve existing MusicXML during migration as a legacy entry with no PDF or known parser provenance; later PDF reuploads add source entries.

Anonymous shares use long, unguessable IDs. Keep their R2 objects private and serve them only after the Worker checks share status; no client-side encryption. A share expires two weeks after the setlist date, or two weeks after creation if it has no date; the leader may stop it earlier. Run scheduled daily cleanup of expired shares. Expiry and revocation must be enforced by the Worker on access, independently of the cleanup schedule. Existing Drive-backed links end during migration; anonymous recipient overlays never sync.

## Song bundles, deletion and export

The one-off migration merges identical charts from the two existing Team libraries, using content hashes to identify identical content, while preserving setlist references. Different charts remain distinct variants; do not discard a version or silently resolve a conflict. The two libraries were originally split from the same source.

A current song bundle may combine ChordPro and current MusicXML into one R2 object for a single normal sync read. PDF sources remain separate and are excluded from routine sync. Source PDFs and successful MusicXML parse results are immutable. Keep old bundles while parse history refers to them. A new successful parse can create a new bundle with the existing ChordPro and new MusicXML; a ChordPro change can create a bundle with the existing MusicXML. A parse that produces identical MusicXML can record the parser version and point directly to the existing immutable bundle when its contents match. A version check protects the current pointer from concurrent updates; failed parses leave it unchanged. Existing MusicXML migrates as a legacy entry without a source PDF until reuploads supply PDFs.

A deleted song disappears from the library immediately and is recoverable by an admin for 30 days; after that its stored objects and history are removed. Define how cleanup handles any shared object references before implementation.

Church export includes church data and setlists, with separate options for current ChordPro, latest source PDFs and pad audio. It excludes MusicXML and parse history. This export is not a substitute for a backup and recovery design (see TODO).

An anonymous share's expired received setlist, charts and local overlays are removed on regular sync, app startup or opening the share, including while offline. The Worker enforces expiry on access and scheduled daily cleanup removes expired server-side objects.


## Promote a personal space

A person can explicitly promote a personal space to a new church, choosing the personal setlists to copy into its first team. Copy their referenced songs into the new church library and point the copied setlists to those songs. Offer an optional, initially unchecked choice to copy the whole personal library as well. The original personal space, songs and setlists remain. This is an explicit exception to the general no-cross-library-copy rule; ordinary church use and anonymous shares are not exceptions. Preserve provenance and review the applicable licence terms for this workflow.

The person promoting the personal space becomes the new church's first admin. Promotion copies the selected songs' complete source PDF and parse history as well as their current chart. Preserve provenance in the new library.

When creating a church, a CCLI number matching an existing church can be shown as a possible match, with an option to ask an existing admin for an invitation. Explain that the entered number may be incorrect. A match does not automatically join the person or prevent them from continuing to create a church. Design the lookup so it does not expose private church or member information unnecessarily.

## Church setup and administration

A new member initially follows the team named by their invitation. Keep the existing invitation rules: worship leader and member links may be used by whoever has the link, while an admin invitation is restricted to its named email. Followed teams sync as an account-wide preference.

A church can be created without a CCLI number. While it is missing, show admins a persistent, unobtrusive reminder on the church settings page; do not block imports or live use. A possible matching church should be offered during creation without blocking it, and explain that the entered number might be incorrect.

Only admins may create or archive teams. An admin can restore an archived team with its existing identity and history. Historical setlists retain the leader's name when that person leaves the church or loses the worship leader role, but they are no longer offered as a leader for new or edited setlists.

Provide a church admin console separate from the normal setlist and library UI for church settings, membership and roles, teams, licences, exports and archived items. A service-wide operator console is future work and has a separate permission boundary. Any church member may download the source PDF of a song they can access.

## PDF import, reparsing and investigation

Any church member may download a source PDF they can access. Worship leaders and admins may upload PDFs as part of bookmarklet import; its initial parse runs as part of that import. Only church admins may manually reparse an existing PDF. A trusted parser-release job may reparse current source PDFs and retry failed PDFs across church and personal libraries in the background, including failed imports that never became current; skip songs without a PDF. Historical PDFs remain available for an admin to reparse. A successful reparse of a non-current PDF stays in history and does not become current automatically.

Save an uploaded immutable PDF even if its initial parse fails, leave any current MusicXML unchanged and emit a telemetry alert so the failure can be investigated. Report parser failures for both church and personal libraries, including failures during imports and reparses. Include the error, parser version and identifiers needed to locate the PDF without attaching the PDF or chart text. Provide restricted operator access to retrieve stored church or personal PDFs for investigation. Define operator authorization before implementation; no access audit is required now.

## Deletion and membership removal

When a church member leaves or is removed, server access stops immediately. Remove their synced church overlays from server storage and reset their followed-team choices for that church. Each device removes downloaded church setlists and charts when it next learns membership has ended, but retains that person's overlays locally. An offline device cannot learn of the change until it reconnects. If the person rejoins with the same account, offer an explicit choice to sync retained overlays from that device again; different devices may hold different versions.

Source PDFs remain in the song's history until the whole song is deleted. Church deletion has a 30-day recovery period: the church and its content are inaccessible in normal use, but an admin can restore them during that period. Afterward, remove content and membership and retain the minimal church register with current licence details. Preserve enough authorization during the recovery period for an admin to restore it, without permitting normal access.

Account deletion has a 30-day recovery period for the personal library and synced preferences. A last church admin must appoint another admin or delete the church before deleting their account.

CCLI usage reporting includes archived teams by default, uses the last 12 months initially, and allows an admin to choose another date range. A church match during setup may show name and location to distinguish similarly named churches.

Church members are Chordless accounts, not entries in a separate address book. A linked setlist leader shows the account’s current name, which is account-wide across churches. Preserve a usable historical name when an account is no longer linked or eligible.

## One personal space per account

Each account has exactly one personal space, with one owner; enforce the one-to-one account relationship. The person promoting a personal space becomes the new church’s first admin. Signed-out personal use remains available locally. On sign-in, ask before combining local personal data with an existing account personal space. If declined, leave local data on the device and unuploaded, make the choice available later, and do not block the account’s church access. Never silently lose either copy. Migrate any existing personal spaces into that one space, merging identical songs while preserving differing variants, all setlists and personal overlays. Preserve or explicitly map existing identifiers and references; do not discard data on a collision.

A church member can import and use a song locally; only a worship leader or admin may add it to the shared church library. During a church's 30-day deletion period, devices remove its downloaded shared data when they learn it has been deleted. Personal overlays follow the local-retention and explicit resync behavior for ended membership. If the church is restored, devices can download shared data again.

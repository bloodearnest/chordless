# Church and team model: migration design

This is the first design step for [CENTRAL_STORAGE.md](CENTRAL_STORAGE.md), not a schema or rollout. Decisions about membership, licence records and retention remain open; do not migrate production data until they are settled.

## What exists

The current `teams` row represents the whole shared space: its identity (`space_id`), name, owner, Drive root and CCLI licence. Membership, invitations, file references and events are keyed to that id. D1's `space_songs`, `space_setlists`, `space_people` and `space_pad_sets` likewise belong to that same id. The device has a separate database for each space. Personal spaces remain separate from Teams.

This conflates a church's library and its team's history. Adding a second team requires a church identity and authorization boundary shared by the teams, and a distinct team identity for setlists. Simply creating another current Team would create another library, contrary to the agreed model.

## Proposed changes to the existing schema

Start from the tables and constraints in migrations `0011`–`0013`; this is a schema delta, not a replacement data model. Preserve the existing columns, JSON fields, validation, indexes and version guards unless a specific change below requires an equivalent update. In particular, a setlist song carries its own key, tempo, notes, annotations and JSON `extra`; its metadata must survive unchanged. Whether setlist songs remain rows or become a JSON document is a design decision to resolve against the existing API and reporting requirements, not a license to discard their metadata.

| Current | Proposal | Ownership / migration |
|---|---|---|
| — | `churches` | New church identity and name; licence records and retention need design. |
| `teams` | `teams` | Add a church foreign key. Keep each existing `space_id` value as the team identity; rename the column to `team_id` when dependent relationships and routes can move together. |
| `space_songs` | `church_songs` | Change ownership from team to the church or personal library; preserve song UUIDs and fields. Add reference(s) to R2 chart content and source PDFs; their exact representation and immutable PDF version history need design. |
| `space_setlists` | `team_setlists` | Team-owned; preserve IDs, fields, JSON `body`, unique setlist ID, date index and version guard. |
| `space_setlist_songs` | `team_setlist_songs` | Preserve entry order and metadata, including JSON `annotations` and `extra`; enforce that each referenced song belongs to the team's church. |
| `space_people` | `team_people` | Rename proposed; confirm whether people are shared across a church before fixing ownership. |
| `space_pad_sets` | `team_pad_sets` | Rename proposed; confirm whether pad sets belong to a church or team. |
| `team_members`, `team_invites`, `team_events` | Existing tables | Preserve their data and constraints; membership, invitation and retained licence-event ownership need decisions. |
| `accounts`, `account_identities`, `account_emails`, `sessions`, `login_codes` | Existing tables | Retain account and sign-in behavior. |
| `account_drive`, `team_refs`, `team_credentials` | Retire after migration | Drive credentials and file references remain until migration and supported-client cutover are complete. Review `teams.root_ref`, `credential`, `owner_provider`, `owner_sub` and `storage` at the same time; remove a field only after confirming no remaining dependency. |

Use `STRICT` tables and ULIDs for **new** identifiers. Existing team, song and setlist IDs remain unchanged opaque strings. Declare foreign keys with deliberate delete behavior and supporting indexes. Migration must carry existing JSON, defaults, checks and indexes forward, and retain the version guards in `0013` or their equivalent. Rehearse the real migration with production-shaped data and foreign keys enabled, as [SCHEMA_RULES.md](SCHEMA_RULES.md) requires.

R2 holds objects; the proposal does not assume separate R2 tables. A chart and PDF reference may be stored with the song, but a single PDF key alone does not establish the agreed history of multiple immutable source PDFs. Decide how versions, import provenance and parser history are represented before specifying columns. Anonymous shares will be redesigned; encryption is an open decision, not assumed necessary for R2.

## Migration boundary

For each existing Team, the one-off move must create one church and one team, preserve the existing song and setlist identities and their relationships, and carry membership, licence details and history forward. Determine how existing space ids and links map to the new identities before choosing keys or changing routes. Migration must validate the mapping, preserve local changes and fail rather than guess if it cannot preserve data. Move metadata and R2 content together only after verification; retain Drive data and a recovery path until confirmed.

Songs belong to a church's library; multiple teams use that same library. Setlists belong to a team and reference only that church's songs. No operation copies songs across churches or personal libraries. Personal use remains possible without a church. Authorization must check the actual church or team, not merely a storage key or an identifier supplied by the client.

## Decisions: churches, libraries and migration

Church membership grants access to the church's song library. Use a shared `libraries` parent for church and personal libraries: a library belongs to exactly one church or one personal account, enforced by a database check. Songs belong to a library; teams belong to a church and use its library. A personal library does not require a fictitious church. The exact keys, foreign keys and uniqueness constraints must preserve existing song identities and meet [SCHEMA_RULES.md](SCHEMA_RULES.md).

A church initially records its name, CCLI licence number, country, city or town, and optionally a postcode or ZIP code. It also records a JSON document of the specific licences it holds, whose contents may vary by country. This information is for posterity, not automatic enforcement. Define its history, corrections and retention before implementing the schema.

The one-off migration may drop existing anonymous shares, pads and invitations. **Preserve personal overlays** and their relationship to the correct user and setlist. An anonymous recipient's share overlays stay on that device and are never synced; this does not discard overlays belonging to signed-in users.

## Decisions needed before schema work

- Whether church membership grants access to every team’s setlists, and how team membership and roles are assigned and inherited.
- Which church information, licence types and changes are recorded, who may change them, and which records survive deletion.
- How the current space id, device database, links, live rooms and API routes map to church and team identities while older clients still exist.
- How existing shared people and retained personal overlays are scoped in the new model.
- How personal library access and offline synchronization are authorized.

After these decisions, specify schema and API changes, migration invariants and failure handling, then rehearse the real migration against existing-shaped data as required by [SCHEMA_RULES.md](SCHEMA_RULES.md). R2 object layout and bucket jurisdiction are designed alongside, but are not prerequisites for choosing the membership model.

## Existing Teams: one church

The owner confirmed that both existing Teams belong to the same church. A read-only inspection of the 2026-11-21 backup found two active Teams, both still on Drive, with the same owner account; one has a CCLI licence number and one has none. There are no D1 song, setlist, person or pad-set rows yet. The backup passes `foreign_key_check`.

The one-off migration therefore creates **one church and one shared library for both existing teams**, not one church per team. Preserve each existing `space_id` as its team ID, and retain song and setlist IDs. Import and reconcile both Drive libraries into the one church library without discarding variants or silently overwriting different content. Preserve overlays. Carry forward the recorded licence and its history; the missing number on the other Team is not evidence of a different church. Verify the source data and resolve any collisions explicitly before switching either Team.

Each device migrates its own current space databases after updating, independently of the server cutover. Preserve each team's setlists and overlays, and consolidate accessible song data into the church library without losing local edits. The local migration must be restartable and must not remove source data until the consolidated library is verified. Preserve existing setlist URLs by resolving their IDs to the team and church library. Existing anonymous share links and live rooms can end. New routes name churches, libraries and teams; old clients must update before cutover and old write routes must refuse stale writes rather than silently accepting them. Remove compatibility routes only after supported clients have moved.

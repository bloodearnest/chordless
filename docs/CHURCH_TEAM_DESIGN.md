# Church and team model: migration design

This is the first design step for [CENTRAL_STORAGE.md](CENTRAL_STORAGE.md), not a schema or rollout. Decisions about membership, licence records and retention remain open; do not migrate production data until they are settled.

## What exists

The current `teams` row represents the whole shared space: its identity (`space_id`), name, owner, Drive root and CCLI licence. Membership, invitations, file references and events are keyed to that id. D1's `space_songs`, `space_setlists`, `space_people` and `space_pad_sets` likewise belong to that same id. The device has a separate database for each space. Personal spaces remain separate from Teams.

This conflates a church's library and its team's history. Adding a second team requires a church identity and authorization boundary shared by the teams, and a distinct team identity for setlists. Simply creating another current Team would create another library, contrary to the agreed model.

## Migration boundary

For each existing Team, the one-off move must create one church and one team, preserve the existing song and setlist identities and their relationships, and carry membership, licence details and history forward. Determine how existing space ids and links map to the new identities before choosing keys or changing routes. Migration must validate the mapping, preserve local changes and fail rather than guess if it cannot preserve data. Move metadata and R2 content together only after verification; retain Drive data and a recovery path until confirmed.

Songs belong to a church's library; multiple teams use that same library. Setlists belong to a team and reference only that church's songs. No operation copies songs across churches or personal libraries. Personal use remains possible without a church. Authorization must check the actual church or team, not merely a storage key or an identifier supplied by the client.

## Decisions needed before schema work

- Whether church membership grants library access to all its teams, and how team membership and roles are assigned and inherited.
- Which church information, licence types and changes are recorded, who may change them, and which records survive deletion.
- How the current space id, device database, links, live rooms and API routes map to church and team identities while older clients still exist.
- How existing shared people, pads, invitations and personal overlays are scoped in the new model.
- How personal libraries are represented and authorized without inventing a church for their users.

After these decisions, specify schema and API changes, migration invariants and failure handling, then rehearse the real migration against existing-shaped data as required by [SCHEMA_RULES.md](SCHEMA_RULES.md). R2 object layout and bucket jurisdiction are designed alongside, but are not prerequisites for choosing the membership model.

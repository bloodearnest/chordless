-- A team that moved into a church (adopting it, docs/CUTOVER.md) kept its members as members of the church, but nobody followed
-- the team, and a church team that is not followed is not on a person's home page and has no setlists there. Each member of
-- such a team follows it. (Data only: no table changes. Adopting a team does this itself from now on.)
INSERT OR IGNORE INTO followed_teams (account_id, space_id)
SELECT m.account_id, m.space_id
FROM team_members m
JOIN teams t ON t.space_id = m.space_id
JOIN church_members c ON c.church_id = t.church_id AND c.account_id = m.account_id
WHERE t.church_id IS NOT NULL AND t.ended_at IS NULL;

INSERT OR IGNORE INTO followed_teams (account_id, space_id)
SELECT t.owner_account_id, t.space_id
FROM teams t
JOIN church_members c ON c.church_id = t.church_id AND c.account_id = t.owner_account_id
WHERE t.church_id IS NOT NULL AND t.ended_at IS NULL AND t.owner_account_id IS NOT NULL;

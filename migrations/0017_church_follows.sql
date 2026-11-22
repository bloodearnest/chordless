-- A church member's choice of teams to show on their homepage. Legacy Team membership and
-- invitations continue unchanged; these preferences are for the new church model.
CREATE TABLE followed_teams (
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES teams (space_id) ON DELETE CASCADE,
  PRIMARY KEY (account_id, space_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX followed_teams_team ON followed_teams (space_id);
-- Preserve the invitation address when a non-admin invitation is accepted by a different account.
ALTER TABLE church_members ADD COLUMN invited_as TEXT CHECK (invited_as IS NULL OR invited_as = lower(invited_as));
CREATE INDEX churches_ccli_licence ON churches (ccli_licence) WHERE ccli_licence IS NOT NULL;

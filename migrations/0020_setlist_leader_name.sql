-- A setlist's leader may be a name in words: for a personal setlist, which has one person in it and no one else
-- to choose from, and for a team's setlist that kept the name of a leader who has no account (docs/CHURCH_TEAM_DESIGN.md:
-- "preserve historical leader names without linked accounts"). `leader_id` stays a foreign key to an account,
-- and a team's leader is chosen from them. The two are never both set, and a name is 1 to 200 characters (a rule
-- across columns of one row is a CHECK: docs/SCHEMA_RULES.md). Which may write a name is the Worker's: a person
-- types one on their own setlist, and a team's API keeps one that is there but never makes one.
-- Additive: a column with a check, which every existing row passes (its name is NULL).
ALTER TABLE setlists ADD COLUMN leader_name TEXT
  CHECK (leader_name IS NULL OR (length(leader_name) BETWEEN 1 AND 200 AND leader_id IS NULL));

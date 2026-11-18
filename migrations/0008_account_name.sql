-- The name a person gives for themselves (asked at their first sign-in, and used in Teams and on their Account
-- page). Null until they have: a Google sign-in is not guaranteed to say one, and an emailed code never does.
-- Only additive: the Worker before this one carries on without the column. Back the database up first
-- (just db-backup).

ALTER TABLE accounts ADD COLUMN name TEXT;

-- When Chordless emailed an invite (null if it was not emailed: held back by a limit, or it could not be sent), so the list
-- of people can say "Emailed 2 days ago" or "Not emailed" and offer to send it again. Only additive: the Worker before this
-- one carries on without the column. Back the database up first (just db-backup).

ALTER TABLE team_invites ADD COLUMN emailed_at TEXT;

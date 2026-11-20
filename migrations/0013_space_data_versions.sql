-- A space's records refuse a write made from an out-of-date version (migrations/0012_space_data.sql, worker/src/space-data.ts).
-- A record's `version` can only move to the next one: a trigger on each table aborts an update that names any other, and
-- D1 undoes a batch if a statement fails, so a change made from a version the row has since left writes nothing, a
-- setlist's songs included. A write names the version it expects plus one. The rule is in the schema, so no code path
-- can forget it; the error is `stale_version`, which the Worker reads.
--
-- Additive: a trigger changes no data. (0012 first shipped with a guard statement in the Worker doing this job; this
-- replaces it, in a migration of its own because 0012 was already merged.)

CREATE TRIGGER space_songs_version BEFORE UPDATE ON space_songs
WHEN NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'stale_version');
END;

CREATE TRIGGER space_setlists_version BEFORE UPDATE ON space_setlists
WHEN NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'stale_version');
END;

CREATE TRIGGER space_people_version BEFORE UPDATE ON space_people
WHEN NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'stale_version');
END;

CREATE TRIGGER space_pad_sets_version BEFORE UPDATE ON space_pad_sets
WHEN NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'stale_version');
END;

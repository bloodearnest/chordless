-- Two sets of tables become documents (docs/SCHEMA_RULES.md, "A document, or a table"). Nothing queries them or joins to
-- them, and nothing needs the database to keep one row consistent with another: each is read and written whole by one
-- owner, with a version to refuse a stale write.
--
--  * What a person keeps for themselves (0021's setlist_overlays, song_overlays and account_preferences) is one document
--    an account owns: `{ settings, setlists: { <setlist_id>: … }, songs: { <song_uuid>: … } }`. The Worker leaves out
--    what the account can no longer reach when it reads and writes it, which the foreign keys did.
--  * A library's pad sets (0022's library_pad_sets, a list of ids and names; the audio is in R2) are a JSON array on
--    the library, `[{ id, name, modifiedAt }]`, with a version. A name is unique in the Worker, under that version.
--
-- What the dropped tables held is carried over (they were deployed a few hours before this).
CREATE TABLE account_overlays (
  account_id TEXT NOT NULL PRIMARY KEY REFERENCES accounts (account_id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (json_valid(body) AND json_type(body) = 'object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  modified_at TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TRIGGER account_overlays_version BEFORE UPDATE ON account_overlays
WHEN NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'stale_version');
END;

-- (json() around each part: a value that has been through coalesce or a subquery may have lost its JSON type, and would
-- be written into the document as a string; which SQLite versions do is not the same)
INSERT INTO account_overlays (account_id, body, version, modified_at)
SELECT a.account_id,
  json_object(
    'settings', json(coalesce((SELECT p.body FROM account_preferences p WHERE p.account_id = a.account_id), '{}')),
    'setlists', json(coalesce((SELECT json_group_object(o.setlist_id, json(o.body)) FROM setlist_overlays o WHERE o.account_id = a.account_id), '{}')),
    'songs', json(coalesce((SELECT json_group_object(o.song_uuid, json(o.body)) FROM song_overlays o WHERE o.account_id = a.account_id), '{}'))
  ),
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM accounts a
WHERE EXISTS (SELECT 1 FROM account_preferences p WHERE p.account_id = a.account_id)
  OR EXISTS (SELECT 1 FROM setlist_overlays o WHERE o.account_id = a.account_id)
  OR EXISTS (SELECT 1 FROM song_overlays o WHERE o.account_id = a.account_id);

ALTER TABLE libraries ADD COLUMN pad_sets TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(pad_sets) AND json_type(pad_sets) = 'array');
ALTER TABLE libraries ADD COLUMN pad_sets_version INTEGER NOT NULL DEFAULT 1 CHECK (pad_sets_version >= 1);

UPDATE libraries SET pad_sets = coalesce(
  (SELECT json_group_array(json_object('id', p.pad_set_id, 'name', p.name, 'modifiedAt', p.modified_at))
   FROM library_pad_sets p WHERE p.library_id = libraries.library_id), '[]');

DROP TABLE setlist_overlays;
DROP TABLE song_overlays;
DROP TABLE account_preferences;
DROP TABLE library_pad_sets;

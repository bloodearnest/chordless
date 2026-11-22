-- Library-owned song metadata for the church and personal storage model. Additive: existing
-- Drive-backed Teams and space_songs stay untouched until the controlled move. Song content lives
-- separately; source_history is metadata and object references, never chart or PDF bytes.
CREATE TABLE library_songs (
  library_id TEXT NOT NULL REFERENCES libraries (library_id) ON DELETE CASCADE,
  song_uuid TEXT NOT NULL CHECK (song_uuid <> ''),
  song_id TEXT NOT NULL CHECK (song_id <> ''),
  title TEXT NOT NULL,
  ccli TEXT,
  song_key TEXT,
  licence TEXT,
  is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
  variant_of TEXT,
  variant_label TEXT NOT NULL DEFAULT '',
  content_hash TEXT,
  bundle_ref TEXT CHECK (bundle_ref IS NULL OR bundle_ref <> ''),
  source_history TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(source_history) AND json_type(source_history) = 'array'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  modified_at TEXT NOT NULL,
  PRIMARY KEY (library_id, song_uuid)
) STRICT;

CREATE INDEX library_songs_song_id ON library_songs (library_id, song_id);
CREATE INDEX library_songs_ccli ON library_songs (library_id, ccli);

CREATE TRIGGER library_songs_version BEFORE UPDATE ON library_songs
WHEN NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'stale_version');
END;

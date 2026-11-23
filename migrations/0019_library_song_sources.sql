-- The source PDFs of library songs (docs/CENTRAL_STORAGE.md, step 4). Additive: nothing existing
-- reads or changes. A source is immutable: a different PDF of a song is another row, and earlier
-- ones stay. The bytes are in private R2 (pdf_ref); this is metadata and the key of what the Worker
-- read from them (the lead sheet as MusicXML, with the version of the reader that read it).
CREATE TABLE library_song_sources (
  library_id TEXT NOT NULL,
  song_uuid TEXT NOT NULL,
  -- The SHA-256 of the PDF, in lower-case hex: the same PDF of the same song is stored once
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  pdf_ref TEXT NOT NULL CHECK (pdf_ref <> ''),
  -- How it came in ('file', 'email', 'songselect'): open, so not a CHECK (docs/SCHEMA_RULES.md)
  origin TEXT NOT NULL CHECK (origin <> ''),
  file_name TEXT CHECK (file_name IS NULL OR file_name <> ''),
  imported_at TEXT NOT NULL,
  -- The account that imported it; the row outlives the account
  imported_by TEXT REFERENCES accounts (account_id) ON DELETE SET NULL,
  -- What was read from it: NULL until it has been, or when it was not a lead sheet that can be read
  parse_ref TEXT CHECK (parse_ref IS NULL OR parse_ref <> ''),
  parse_reader INTEGER CHECK (parse_reader IS NULL OR parse_reader >= 1),
  parsed_at TEXT,
  PRIMARY KEY (library_id, song_uuid, sha256),
  FOREIGN KEY (library_id, song_uuid) REFERENCES library_songs (library_id, song_uuid) ON DELETE CASCADE,
  CHECK ((parse_ref IS NULL) = (parse_reader IS NULL) AND (parse_ref IS NULL) = (parsed_at IS NULL))
) STRICT, WITHOUT ROWID;

CREATE INDEX library_song_sources_imported_by ON library_song_sources (imported_by);

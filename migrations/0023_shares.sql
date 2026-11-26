-- Anonymous setlist shares (docs/CENTRAL_STORAGE.md, "Anonymous sharing"): a link that lets anyone who holds the
-- unguessable `share_id` read one real setlist and its songs, with no account, until the share ends. It is no copy: the
-- Worker reads the setlist and its songs from where they are kept, so the link always shows their current state, and
-- this row only says whether the link may still be served. A setlist has one live share at a time (stopping one frees
-- the setlist for another). Additive: a new table. These replace the Drive-backed links (`/api/share/<drive file>`),
-- which keep working until the cutover (step 8).
CREATE TABLE shares (
  share_id TEXT NOT NULL PRIMARY KEY CHECK (share_id <> ''),
  setlist_id TEXT NOT NULL REFERENCES setlists (setlist_id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  stopped_at TEXT
) STRICT, WITHOUT ROWID;

CREATE UNIQUE INDEX shares_live_setlist ON shares (setlist_id) WHERE stopped_at IS NULL;
CREATE INDEX shares_created_by ON shares (created_by);
CREATE INDEX shares_expires ON shares (expires_at);

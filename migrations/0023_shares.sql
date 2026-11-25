-- Anonymous setlist shares (docs/CENTRAL_STORAGE.md, "Anonymous sharing"): a link the Worker serves from private R2 to
-- anyone who holds the unguessable `share_id`, until it expires or is stopped. The bundle (the setlist and its charts,
-- as the leader's device made it) is one R2 object, `shares/<share_id>/bundle.json`, replaced on each update so the link
-- stays the same; this row says whether it may still be served, and its `version` is what a reader asks whether it has.
-- A setlist has one live share at a time (stopping one frees the setlist for another). Additive: a new table. These
-- replace the Drive-backed links (`/api/share/<drive file>`), which keep working until the cutover (step 8).
CREATE TABLE shares (
  share_id TEXT NOT NULL PRIMARY KEY CHECK (share_id <> ''),
  setlist_id TEXT NOT NULL REFERENCES setlists (setlist_id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  stopped_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  modified_at TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE UNIQUE INDEX shares_live_setlist ON shares (setlist_id) WHERE stopped_at IS NULL;
CREATE INDEX shares_created_by ON shares (created_by);
CREATE INDEX shares_expires ON shares (expires_at);

CREATE TRIGGER shares_version BEFORE UPDATE ON shares
WHEN NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'stale_version');
END;

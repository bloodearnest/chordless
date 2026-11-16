-- Chordless sessions: a sign-in (Google today, an emailed code next) ends at the Worker, which issues its own
-- tokens, so that what proves who is asking does not depend on how they signed in. A session is a row here:
-- the refresh token that keeps it going is never kept, only a hash of its secret, and it is replaced every time
-- it is used (docs/SPACES.md, "Sign-in"; docs/SECURITY.md). The short-lived access token is signed, not stored.
--
-- Only additive, as 0003 (docs/CI.md). Holds no song, setlist or pad content (CLAUDE.md, "Spaces and copyright").

CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  -- the address the sign-in proved, for the access token to carry
  email TEXT NOT NULL,
  -- hash of the secret of the refresh token in use, and of the one it replaced (for reuse detection)
  token_hash TEXT NOT NULL,
  previous_hash TEXT,
  rotated_at TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT, WITHOUT ROWID;

CREATE INDEX sessions_account ON sessions (account_id);

-- The Google Drive connection of an account (docs/ACCOUNT.md, "Google Drive"): the encrypted refresh-token blob that
-- used to live on each device, kept once for the account, so that a device that signs in (by email or Google) can
-- sync with no second Google popup. The Worker decrypts it only to ask Google for an access token (`POST
-- /api/account/drive/token`); the page then talks to Drive itself, as before.
--
-- The blob is the same AES-256-GCM JWE the devices held (worker/src/blob.ts, key JWE_ENCRYPTION_KEY), so a D1 export
-- alone does not give a refresh token. Holds no song, setlist or pad content (CLAUDE.md, "Spaces and copyright").
--
-- Only additive: the Worker before this one carries on without the table (devices keep their own blob until the page
-- adopts it). Back the database up first (just db-backup).

CREATE TABLE account_drive (
  account_id TEXT PRIMARY KEY,
  -- the encrypted blob (a refresh token and its owner)
  blob TEXT NOT NULL,
  -- the Google account Drive is reached as: it need not be an address the person signs in with
  google_email TEXT NOT NULL,
  -- what Google granted (the Drive scope is why the row exists)
  scope TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT, WITHOUT ROWID;

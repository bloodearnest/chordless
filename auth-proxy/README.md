# Setalight Auth Proxy

Stateless OAuth proxy for Google Drive integration, deployed as a Cloudflare Worker.

## Architecture

- **Stateless**: Never stores refresh tokens in persistent storage
- **JWE Blobs**: Encrypts refresh tokens into client-held JWE blobs
- **On-Demand Operations**: Decrypts blobs to perform Drive API calls, then discards tokens
- **KV Storage**: Stores shared setlists with automatic expiration (30 days)

## Endpoints

### `POST /oauth/callback`

Exchange authorization code for encrypted token blob.

**Request:**

```json
{
  "code": "auth-code-from-gsi",
  "id_token": "id-token-from-gsi"
}
```

**Response:**

```json
{
  "blob": "eyJhbGc...",
  "access_token": "ya29...",
  "expires_in": 3600,
  "id_token": "id-token-from-google",
  "user": {
    "name": "Chris Worship",
    "email": "chris@example.com",
    "picture": "https://lh3.googleusercontent.com/...",
    "given_name": "Chris",
    "family_name": "Worship",
    "sub": "google-user-id"
  }
}
```

### `POST /session/invite`

Add user as reader to a Drive file.

**Request:**

```json
{
  "blob": "eyJhbGc...",
  "id_token": "current-id-token",
  "file_id": "drive-file-id",
  "email": "user@example.com"
}
```

**Response:**

```json
{
  "success": true,
  "permission_id": "permission-id"
}
```

### `POST /session/revoke`

Remove user permission from Drive file.

**Request:**

```json
{
  "blob": "eyJhbGc...",
  "id_token": "current-id-token",
  "file_id": "drive-file-id",
  "permission_id": "permission-id"
}
```

**Response:**

```json
{
  "success": true
}
```

### `POST /api/share`

Store setlist for sharing.

**Request:**

```json
{
  "setlist": {
    /* complete setlist data */
  }
}
```

**Response:**

```json
{
  "id": "abc123de",
  "expires_at": "2024-12-08T00:00:00Z"
}
```

### `GET /api/share/:id`

Retrieve shared setlist.

**Response:**

```json
{
  "setlist": {
    /* setlist data */
  },
  "created_at": "2024-11-08T00:00:00Z"
}
```

## Setup

### 1. Install Dependencies

```bash
cd auth-proxy
npm install
```

**Note:** This project uses Wrangler 4.x. If you have Wrangler 3.x installed globally, you may need to use `npx wrangler` instead of `wrangler` for commands, or update your global installation with `npm install -g wrangler@latest`.

### 2. Create Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable Google Drive API
4. Create OAuth 2.0 credentials (Web application)
5. Add authorized redirect URI: `https://your-worker.workers.dev/oauth/callback`
6. Note the Client ID and Client Secret

### 3. Generate Encryption Key

```bash
# Generate a 256-bit key and base64 encode it
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 4. Create KV Namespace

```bash
# Create KV namespace for setlist storage
wrangler kv namespace create "SETLISTS"
wrangler kv namespace create "SETLISTS" --preview

# Update wrangler.toml with the namespace IDs
```

### 5. Set Secrets

```bash
# Set the encryption key
wrangler secret put JWE_ENCRYPTION_KEY
# Paste the base64 key from step 3

# Set Google OAuth credentials
wrangler secret put GOOGLE_CLIENT_ID
# Paste your Client ID

wrangler secret put GOOGLE_CLIENT_SECRET
# Paste your Client Secret

wrangler secret put GOOGLE_REDIRECT_URI
# Enter: https://your-worker.workers.dev/oauth/callback
```

### 6. Deploy

```bash
# Test locally
npm run dev

# Deploy to Cloudflare
npm run deploy
```

## Security Notes

- JWE blobs use AES-256-GCM encryption
- Refresh tokens are never logged or stored persistently
- ID token verification ensures blob owner matches requester
- Blobs include `kid` (key ID) field for future key rotation
- CORS should be restricted to your domain in production (update `CORS_HEADERS` in index.js)

## Key Rotation

To rotate encryption keys:

1. Generate new key
2. Set new secret: `wrangler secret put JWE_ENCRYPTION_KEY_V2`
3. Update code to check `kid` field and use appropriate key
4. Users will need to re-authenticate to get new blobs

## Monitoring

View logs:

```bash
wrangler tail
```

View KV storage:

```bash
wrangler kv:key list --namespace-id=YOUR_KV_ID
```

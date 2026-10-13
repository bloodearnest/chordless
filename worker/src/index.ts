/**
 * Chordless Auth Proxy - Cloudflare Worker
 *
 * Stateless OAuth proxy for Google Drive integration.
 * - Exchanges auth codes for tokens, encrypts refresh tokens as JWE blobs
 * - Refreshes access tokens on-demand
 * - Serves share links: the encrypted download from Drive, and the page's preview tags
 * - Performs Drive API operations (invite/revoke) on-demand with decrypted blobs
 */

import { EmailMessage } from 'cloudflare:email'
import * as jose from 'jose'
import { handleEmail, type IncomingEmail, type RateLimit } from './email.ts'
import { exchangeCode, type GoogleEnv, refreshAccessToken, verifyIdToken } from './google-auth.ts'
import { handleShareDownload, type ShareCache, type ShareEnv, shareFileId } from './share.ts'
import { withSharePreview } from './share-page.ts'

/** The worker's bindings, variables and secrets (see wrangler.toml) */
interface Env extends GoogleEnv, ShareEnv {
  ASSETS: { fetch(request: Request): Promise<Response> }
  /** Set only in [env.dev]: serve the component playgrounds */
  DEV_PAGES?: string
  /** Used when the client sends no redirect_uri */
  GOOGLE_REDIRECT_URI?: string
  /** Limits on the emails answered (wrangler.toml [[ratelimits]]): unset in tests and dev */
  EMAIL_PER_SENDER?: RateLimit
  EMAIL_OVERALL?: RateLimit
  /** The address links in email replies point to; chordless.app when unset */
  APP_ORIGIN?: string
  /** Base64 AES-256 key for the token blobs */
  JWE_ENCRYPTION_KEY: string
}

/** What the encrypted blob holds: the owner, and the refresh token */
interface BlobData {
  owner_email: string | undefined
  owner_sub: string | undefined
  scopes: string
  refresh_token: string
  created_at: string
  blob_id: string
  /** Key ID, for rotation */
  kid: string
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * The API is only for the app itself, served from the same origin, so there are no CORS
 * headers: browsers block cross-origin reads. Browsers also send some cross-origin requests
 * without a preflight (a POST with a text/plain body), so refuse those here by Origin and
 * Sec-Fetch-Site. Requests with neither header (curl, tests) are not browsers acting for a page.
 */
function isCrossOrigin(request: Request, url: URL) {
  const origin = request.headers.get('Origin')
  if (origin && origin !== url.origin) return true
  const site = request.headers.get('Sec-Fetch-Site')
  return site !== null && site !== 'same-origin' && site !== 'none'
}

/**
 * Router - handles incoming requests
 */
export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    const url = new URL(request.url)
    const path = url.pathname

    if (
      (path.startsWith('/oauth/') ||
        path.startsWith('/session/') ||
        path.startsWith('/api/share/')) &&
      isCrossOrigin(request, url)
    ) {
      return jsonResponse({ error: 'Cross-origin requests are not allowed' }, 403)
    }

    try {
      // OAuth endpoints
      if (path === '/oauth/callback' && request.method === 'POST') {
        return await handleOAuthCallback(request, env)
      }

      // Token refresh endpoint
      if (path === '/session/refresh' && request.method === 'POST') {
        return await handleTokenRefresh(request, env)
      }

      // Session endpoints (require encrypted blob) - for future Drive collaboration features
      if (path === '/session/invite' && request.method === 'POST') {
        return await handleSessionInvite(request, env)
      }

      if (path === '/session/revoke' && request.method === 'POST') {
        return await handleSessionRevoke(request, env)
      }

      // A share link's download (public, encrypted; see docs/SHARING.md)
      const shareId = shareFileId(path)
      if (shareId !== null) {
        return await handleShareDownload(request, shareId, env, {
          cache: (caches as unknown as { default: ShareCache }).default,
          waitUntil: promise => ctx.waitUntil(promise),
        })
      }

      // A share link opened as a page: the app, with a preview for whatever fetched it
      if (path.startsWith('/s/') && request.method === 'GET') {
        const page = await env.ASSETS.fetch(request)
        if (!page.headers.get('Content-Type')?.includes('text/html')) return page
        const headers = new Headers(page.headers)
        headers.set('X-Robots-Tag', 'noindex, nofollow')
        headers.delete('Content-Length')
        return new Response(withSharePreview(await page.text(), url.origin), {
          status: page.status,
          headers,
        })
      }

      // Dev-only component playgrounds (src/dev/). DEV_PAGES is set only in [env.dev]
      // in wrangler.toml (`npm run dev`). Routed here first via run_worker_first.
      if (path === '/dev' || path.startsWith('/dev/')) {
        if (!env.DEV_PAGES) {
          return new Response('Not Found', { status: 404 })
        }
        return env.ASSETS.fetch(request)
      }

      // Not an API route — delegate to static assets (SPA fallback handles unknown paths)
      return env.ASSETS.fetch(request)
    } catch (error) {
      console.error('Worker error:', error)
      return jsonResponse({ error: 'Internal server error', message: message(error) }, 500)
    }
  },

  /** An email sent to the import address (Cloudflare Email Routing): answered with a link */
  async email(message: IncomingEmail, env: Env) {
    await handleEmail(
      message,
      (from, to, raw) => new EmailMessage(from, to, raw),
      env.APP_ORIGIN ?? 'https://chordless.app',
      { perSender: env.EMAIL_PER_SENDER, overall: env.EMAIL_OVERALL }
    )
  },
}

/**
 * POST /oauth/callback
 *
 * Exchange authorization code for tokens, encrypt refresh token into JWE blob.
 *
 * Request body:
 * {
 *   code: string            // OAuth authorization code
 * }
 *
 * Response:
 * {
 *   blob: string,           // JWE-encrypted token blob
 *   access_token: string,   // Short-lived access token
 *   expires_in: number      // Access token TTL (seconds)
 * }
 */
async function handleOAuthCallback(request: Request, env: Env) {
  const body = await request.json()
  const { code, redirect_uri } = body

  if (!code) {
    return jsonResponse({ error: 'Missing code' }, 400)
  }

  // Use the redirect_uri supplied by the client (its own origin), falling back to the
  // env var. The client passes its origin so this works from localhost, Tailscale, etc.
  const redirectUri = redirect_uri || env.GOOGLE_REDIRECT_URI
  if (!redirectUri) {
    return jsonResponse({ error: 'Missing redirect_uri' }, 400)
  }

  // Exchange code for tokens; the ID token is verified (signature, issuer, audience, expiry)
  const tokens = await exchangeCode(code, redirectUri, env)
  const { refresh_token, access_token, expires_in, scope, id_token, claims: payload } = tokens

  if (!id_token || !payload) {
    return jsonResponse({ error: 'No ID token received. Make sure to request openid scope.' }, 400)
  }
  const email = payload.email as string | undefined
  const sub = payload.sub

  if (!refresh_token) {
    return jsonResponse(
      { error: 'No refresh token received. User may need to revoke and re-authorize.' },
      400
    )
  }

  // Validate that Drive scope was granted
  const REQUIRED_SCOPE = 'https://www.googleapis.com/auth/drive.file'
  if (!scope?.includes(REQUIRED_SCOPE)) {
    return jsonResponse(
      {
        error:
          'Drive access not granted. Please re-authorize and ensure you grant access to Google Drive files.',
        granted_scopes: scope || '',
      },
      400
    )
  }

  // Create JWE blob
  const blobData: BlobData = {
    owner_email: email,
    owner_sub: sub,
    scopes: scope,
    refresh_token: refresh_token,
    created_at: new Date().toISOString(),
    blob_id: crypto.randomUUID(),
    kid: 'default', // Key ID for rotation
  }

  const blob = await encryptBlob(blobData, env)

  const user = {
    name: payload.name || null,
    email: payload.email || null,
    picture: payload.picture || null,
    given_name: payload.given_name || null,
    family_name: payload.family_name || null,
    sub: payload.sub || null,
  }

  return jsonResponse({
    blob,
    access_token,
    expires_in,
    id_token,
    user,
  })
}

/**
 * POST /session/refresh
 *
 * Refresh access token using encrypted blob.
 * Client calls this when their access token expires.
 *
 * The encrypted blob itself proves ownership (only the authorized user has it),
 * so ID token verification is optional for this endpoint.
 *
 * Request body:
 * {
 *   blob: string,              // Encrypted token blob
 *   id_token: string (optional) // ID token for extra verification (not required)
 * }
 *
 * Response:
 * {
 *   access_token: string,   // New short-lived access token
 *   expires_in: number      // Access token TTL (seconds)
 * }
 */
async function handleTokenRefresh(request: Request, env: Env) {
  const { blob, id_token } = await request.json()

  if (!blob) {
    return jsonResponse({ error: 'Missing blob' }, 400)
  }

  // Optional: Verify ID token if provided (extra security layer)
  if (id_token) {
    try {
      const payload = await verifyIdToken(id_token, env)

      // Decrypt blob
      const blobData = await decryptBlob(blob, env)

      // Verify ownership matches ID token
      if (blobData.owner_email !== payload.email || blobData.owner_sub !== payload.sub) {
        return jsonResponse({ error: 'Token mismatch: blob owner does not match ID token' }, 403)
      }
    } catch (error) {
      // If ID token verification fails, continue without it (blob is still valid proof)
      console.warn('ID token verification failed, proceeding with blob only:', message(error))
    }
  }

  // Decrypt blob and refresh access token
  const blobData = await decryptBlob(blob, env)

  const { access_token, expires_in } = await refreshAccessToken(blobData.refresh_token, env)

  return jsonResponse({ access_token, expires_in })
}

/**
 * POST /session/invite
 *
 * Add a user as a reader to a Google Drive file.
 *
 * Request body:
 * {
 *   blob: string,         // Encrypted token blob
 *   id_token: string,     // Current ID token to verify ownership
 *   file_id: string,      // Drive file ID to share
 *   email: string         // Email to invite
 * }
 *
 * Response:
 * {
 *   success: boolean,
 *   permission_id: string
 * }
 */
async function handleSessionInvite(request: Request, env: Env) {
  const { blob, id_token, file_id, email } = await request.json()

  if (!blob || !id_token || !file_id || !email) {
    return jsonResponse({ error: 'Missing required fields' }, 400)
  }

  // Verify ID token
  const payload = await verifyIdToken(id_token, env)

  // Decrypt blob
  const blobData = await decryptBlob(blob, env)

  // Verify ownership
  if (blobData.owner_email !== payload.email || blobData.owner_sub !== payload.sub) {
    return jsonResponse({ error: 'Token mismatch: blob owner does not match ID token' }, 403)
  }

  // Refresh access token (needs client secret)
  const { access_token: accessToken } = await refreshAccessToken(blobData.refresh_token, env)

  // Call Drive API to add permission
  const driveResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${file_id}/permissions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: 'reader',
        type: 'user',
        emailAddress: email,
      }),
    }
  )

  if (!driveResponse.ok) {
    const error = await driveResponse.text()
    return jsonResponse({ error: 'Drive API error', details: error }, driveResponse.status)
  }

  const result = await driveResponse.json()

  return jsonResponse({
    success: true,
    permission_id: result.id,
  })
}

/**
 * POST /session/revoke
 *
 * Remove a user's permission from a Google Drive file.
 *
 * Request body:
 * {
 *   blob: string,           // Encrypted token blob
 *   id_token: string,       // Current ID token to verify ownership
 *   file_id: string,        // Drive file ID
 *   permission_id: string   // Permission ID to revoke
 * }
 *
 * Response:
 * {
 *   success: boolean
 * }
 */
async function handleSessionRevoke(request: Request, env: Env) {
  const { blob, id_token, file_id, permission_id } = await request.json()

  if (!blob || !id_token || !file_id || !permission_id) {
    return jsonResponse({ error: 'Missing required fields' }, 400)
  }

  // Verify ID token
  const payload = await verifyIdToken(id_token, env)

  // Decrypt blob
  const blobData = await decryptBlob(blob, env)

  // Verify ownership
  if (blobData.owner_email !== payload.email || blobData.owner_sub !== payload.sub) {
    return jsonResponse({ error: 'Token mismatch: blob owner does not match ID token' }, 403)
  }

  // Refresh access token (needs client secret)
  const { access_token: accessToken } = await refreshAccessToken(blobData.refresh_token, env)

  // Call Drive API to remove permission
  const driveResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${file_id}/permissions/${permission_id}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  if (!driveResponse.ok && driveResponse.status !== 204) {
    const error = await driveResponse.text()
    return jsonResponse({ error: 'Drive API error', details: error }, driveResponse.status)
  }

  return jsonResponse({ success: true })
}

/**
 * Encrypt blob data into JWE format
 */
async function encryptBlob(data: BlobData, env: Env) {
  const secret = await importEncryptionKey(env.JWE_ENCRYPTION_KEY)

  const jwe = await new jose.CompactEncrypt(new TextEncoder().encode(JSON.stringify(data)))
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', kid: data.kid || 'default' })
    .encrypt(secret)

  return jwe
}

/**
 * Decrypt JWE blob
 */
async function decryptBlob(jwe: string, env: Env): Promise<BlobData> {
  const secret = await importEncryptionKey(env.JWE_ENCRYPTION_KEY)

  const { plaintext } = await jose.compactDecrypt(jwe, secret)
  return JSON.parse(new TextDecoder().decode(plaintext))
}

/**
 * Import symmetric encryption key from base64 string
 */
async function importEncryptionKey(base64Key: string) {
  const keyData = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0))
  return await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
}

/**
 * Helper to return JSON responses
 */
function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

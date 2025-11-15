/**
 * Setalight Auth Proxy - Cloudflare Worker
 *
 * Stateless OAuth proxy for Google Drive integration.
 * - Exchanges auth codes for tokens, encrypts refresh tokens as JWE blobs
 * - Refreshes access tokens on-demand
 * - Stores/retrieves shared setlists in KV storage
 * - Performs Drive API operations (invite/revoke) on-demand with decrypted blobs
 */

import * as jose from 'jose';
import { OAuth2Client } from 'google-auth-library';

/**
 * CORS headers for browser requests
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // TODO: Restrict to your domain in production
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

/**
 * Router - handles incoming requests
 */
export default {
  async fetch(request, env, _ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // OAuth endpoints
      if (path === '/oauth/callback' && request.method === 'POST') {
        return await handleOAuthCallback(request, env);
      }

      // Token refresh endpoint
      if (path === '/session/refresh' && request.method === 'POST') {
        return await handleTokenRefresh(request, env);
      }

      // Session endpoints (require encrypted blob) - for future Drive collaboration features
      if (path === '/session/invite' && request.method === 'POST') {
        return await handleSessionInvite(request, env);
      }

      if (path === '/session/revoke' && request.method === 'POST') {
        return await handleSessionRevoke(request, env);
      }

      // Setlist storage endpoints
      if (path === '/api/share' && request.method === 'POST') {
        return await handleShareSetlist(request, env);
      }

      if (path.startsWith('/api/share/') && request.method === 'GET') {
        const id = path.split('/')[3];
        return await handleGetSetlist(id, env);
      }

      // 404
      return jsonResponse({ error: 'Not found' }, 404);
    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse({ error: 'Internal server error', message: error.message }, 500);
    }
  },
};

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
async function handleOAuthCallback(request, env) {
  const body = await request.json();
  const { code } = body;

  if (!code) {
    return jsonResponse({ error: 'Missing code' }, 400);
  }

  // Exchange code for tokens
  const oauth2Client = new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  });

  const { tokens } = await oauth2Client.getToken(code);
  const { refresh_token, access_token, expiry_date, scope, id_token } = tokens;

  if (!id_token) {
    return jsonResponse({ error: 'No ID token received. Make sure to request openid scope.' }, 400);
  }

  // Verify ID token and extract user info
  const ticket = await oauth2Client.verifyIdToken({
    idToken: id_token,
    audience: env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  const { email, sub } = payload;

  if (!refresh_token) {
    return jsonResponse(
      { error: 'No refresh token received. User may need to revoke and re-authorize.' },
      400
    );
  }

  // Create JWE blob
  const blobData = {
    owner_email: email,
    owner_sub: sub,
    scopes: scope,
    refresh_token: refresh_token,
    created_at: new Date().toISOString(),
    blob_id: crypto.randomUUID(),
    kid: 'default', // Key ID for rotation
  };

  const blob = await encryptBlob(blobData, env);

  const user = {
    name: payload.name || null,
    email: payload.email || null,
    picture: payload.picture || null,
    given_name: payload.given_name || null,
    family_name: payload.family_name || null,
    sub: payload.sub || null,
  };

  return jsonResponse({
    blob,
    access_token,
    expires_in: Math.floor((expiry_date - Date.now()) / 1000),
    id_token,
    user,
  });
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
async function handleTokenRefresh(request, env) {
  const { blob, id_token } = await request.json();

  if (!blob) {
    return jsonResponse({ error: 'Missing blob' }, 400);
  }

  // Optional: Verify ID token if provided (extra security layer)
  if (id_token) {
    const oauth2Client = new OAuth2Client(env.GOOGLE_CLIENT_ID);
    try {
      const ticket = await oauth2Client.verifyIdToken({
        idToken: id_token,
        audience: env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();

      // Decrypt blob
      const blobData = await decryptBlob(blob, env);

      // Verify ownership matches ID token
      if (blobData.owner_email !== payload.email || blobData.owner_sub !== payload.sub) {
        return jsonResponse({ error: 'Token mismatch: blob owner does not match ID token' }, 403);
      }
    } catch (error) {
      // If ID token verification fails, continue without it (blob is still valid proof)
      console.warn('ID token verification failed, proceeding with blob only:', error.message);
    }
  }

  // Decrypt blob and refresh access token
  const blobData = await decryptBlob(blob, env);

  const oauth2Client = new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  });
  oauth2Client.setCredentials({
    refresh_token: blobData.refresh_token,
  });
  const { token } = await oauth2Client.getAccessToken();

  return jsonResponse({
    access_token: token,
    expires_in: 3600, // Google typically returns 1 hour expiry
  });
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
async function handleSessionInvite(request, env) {
  const { blob, id_token, file_id, email } = await request.json();

  if (!blob || !id_token || !file_id || !email) {
    return jsonResponse({ error: 'Missing required fields' }, 400);
  }

  // Verify ID token
  const oauth2ClientForVerify = new OAuth2Client(env.GOOGLE_CLIENT_ID);
  const ticket = await oauth2ClientForVerify.verifyIdToken({
    idToken: id_token,
    audience: env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();

  // Decrypt blob
  const blobData = await decryptBlob(blob, env);

  // Verify ownership
  if (blobData.owner_email !== payload.email || blobData.owner_sub !== payload.sub) {
    return jsonResponse({ error: 'Token mismatch: blob owner does not match ID token' }, 403);
  }

  // Refresh access token (needs client secret)
  const oauth2Client = new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  });
  oauth2Client.setCredentials({
    refresh_token: blobData.refresh_token,
  });
  await oauth2Client.getAccessToken(); // This refreshes and updates credentials

  const accessToken = oauth2Client.credentials.access_token;

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
  );

  if (!driveResponse.ok) {
    const error = await driveResponse.text();
    return jsonResponse({ error: 'Drive API error', details: error }, driveResponse.status);
  }

  const result = await driveResponse.json();

  return jsonResponse({
    success: true,
    permission_id: result.id,
  });
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
async function handleSessionRevoke(request, env) {
  const { blob, id_token, file_id, permission_id } = await request.json();

  if (!blob || !id_token || !file_id || !permission_id) {
    return jsonResponse({ error: 'Missing required fields' }, 400);
  }

  // Verify ID token
  const oauth2ClientForVerify = new OAuth2Client(env.GOOGLE_CLIENT_ID);
  const ticket = await oauth2ClientForVerify.verifyIdToken({
    idToken: id_token,
    audience: env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();

  // Decrypt blob
  const blobData = await decryptBlob(blob, env);

  // Verify ownership
  if (blobData.owner_email !== payload.email || blobData.owner_sub !== payload.sub) {
    return jsonResponse({ error: 'Token mismatch: blob owner does not match ID token' }, 403);
  }

  // Refresh access token (needs client secret)
  const oauth2Client = new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  });
  oauth2Client.setCredentials({
    refresh_token: blobData.refresh_token,
  });
  await oauth2Client.getAccessToken();

  const accessToken = oauth2Client.credentials.access_token;

  // Call Drive API to remove permission
  const driveResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${file_id}/permissions/${permission_id}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!driveResponse.ok && driveResponse.status !== 204) {
    const error = await driveResponse.text();
    return jsonResponse({ error: 'Drive API error', details: error }, driveResponse.status);
  }

  return jsonResponse({ success: true });
}

/**
 * POST /api/share
 *
 * Store a setlist for sharing.
 *
 * Request body:
 * {
 *   setlist: object  // Complete setlist data including songs
 * }
 *
 * Response:
 * {
 *   id: string,      // Short ID for sharing
 *   expires_at: string
 * }
 */
async function handleShareSetlist(request, env) {
  const { setlist } = await request.json();

  if (!setlist) {
    return jsonResponse({ error: 'Missing setlist data' }, 400);
  }

  // Generate short ID (8 characters)
  const id = generateShortId();

  // Store in KV with 30-day expiration
  const expirationTtl = 60 * 60 * 24 * 30; // 30 days in seconds
  const expiresAt = new Date(Date.now() + expirationTtl * 1000).toISOString();

  await env.SETLISTS.put(id, JSON.stringify({ setlist, created_at: new Date().toISOString() }), {
    expirationTtl,
  });

  return jsonResponse({ id, expires_at: expiresAt });
}

/**
 * GET /api/share/:id
 *
 * Retrieve a shared setlist.
 *
 * Response:
 * {
 *   setlist: object,
 *   created_at: string
 * }
 */
async function handleGetSetlist(id, env) {
  if (!id || !/^[a-zA-Z0-9]{8}$/.test(id)) {
    return jsonResponse({ error: 'Invalid ID format' }, 400);
  }

  const data = await env.SETLISTS.get(id);

  if (!data) {
    return jsonResponse({ error: 'Setlist not found or expired' }, 404);
  }

  return jsonResponse(JSON.parse(data));
}

/**
 * Encrypt blob data into JWE format
 */
async function encryptBlob(data, env) {
  const secret = await importEncryptionKey(env.JWE_ENCRYPTION_KEY);

  const jwe = await new jose.CompactEncrypt(new TextEncoder().encode(JSON.stringify(data)))
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', kid: data.kid || 'default' })
    .encrypt(secret);

  return jwe;
}

/**
 * Decrypt JWE blob
 */
async function decryptBlob(jwe, env) {
  const secret = await importEncryptionKey(env.JWE_ENCRYPTION_KEY);

  const { plaintext } = await jose.compactDecrypt(jwe, secret);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

/**
 * Import symmetric encryption key from base64 string
 */
async function importEncryptionKey(base64Key) {
  const keyData = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
  return await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Generate a short ID (8 alphanumeric characters)
 */
function generateShortId() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  const randomValues = new Uint8Array(8);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < 8; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

/**
 * Helper to return JSON responses with CORS
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

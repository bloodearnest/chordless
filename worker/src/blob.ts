import * as jose from 'jose'

/** The key the token blobs are encrypted with (wrangler secret) */
export interface BlobKey {
  /** Base64 AES-256 key for the token blobs */
  JWE_ENCRYPTION_KEY: string
}

/** What the encrypted blob holds: the owner, and the refresh token */
export interface BlobData {
  owner_email: string | undefined
  owner_sub: string | undefined
  scopes: string
  refresh_token: string
  created_at: string
  blob_id: string
  /** Key ID, for rotation */
  kid: string
}

/**
 * Encrypt blob data into JWE format
 */
export async function encryptBlob(data: BlobData, env: BlobKey) {
  const secret = await importEncryptionKey(env.JWE_ENCRYPTION_KEY)

  const jwe = await new jose.CompactEncrypt(new TextEncoder().encode(JSON.stringify(data)))
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', kid: data.kid || 'default' })
    .encrypt(secret)

  return jwe
}

/**
 * Decrypt JWE blob
 */
export async function decryptBlob(jwe: string, env: BlobKey): Promise<BlobData> {
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

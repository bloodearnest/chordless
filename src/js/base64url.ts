/** Bytes as base64url (RFC 4648 §5, no padding): text that is safe in a URL fragment */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The bytes of base64url text; throws if it isn't base64url */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[\w-]*$/.test(text)) throw new Error('Not base64url')
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return Uint8Array.from(binary, c => c.charCodeAt(0))
}

/**
 * The claims of a JWT, read without checking it: only for showing who a token is for (the Worker
 * is what verifies one). Null if it cannot be read.
 */
export function jwtClaims(token: string): Record<string, unknown> | null {
  try {
    const claims: unknown = JSON.parse(
      new TextDecoder().decode(fromBase64Url(token.split('.')[1] ?? ''))
    )
    return typeof claims === 'object' && claims !== null
      ? (claims as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

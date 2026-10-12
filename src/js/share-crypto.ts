/**
 * Encrypting a share bundle and putting its key in a link (docs/SHARING.md). All browser
 * native: CompressionStream and Web Crypto.
 *
 * The file is a 12-byte IV followed by AES-GCM ciphertext of the gzipped JSON. Compress
 * first: ciphertext doesn't compress. The IV is new on every upload; the key lasts as long
 * as the share. AES-GCM also rejects a file that was changed.
 */

import { parseShareBundle, type ShareBundle } from './share-bundle.ts'

const IV_BYTES = 12
const KEY_BYTES = 32

/** A share is a few KB: anything that unpacks far bigger isn't one */
const MAX_UNPACKED_BYTES = 2 * 1024 * 1024

type Bytes = Uint8Array<ArrayBuffer>

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(text: string): Bytes {
  if (!/^[\w-]*$/.test(text)) throw new Error('Not base64url')
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return Uint8Array.from(binary, c => c.charCodeAt(0))
}

/** A new random share key, as it goes in the link and the setlist: 43 base64url characters */
export function generateShareKey(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(KEY_BYTES)))
}

const importKey = (key: string) => {
  const raw = fromBase64Url(key)
  if (raw.length !== KEY_BYTES) throw new Error('The share key is the wrong length')
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function gzip(bytes: Bytes): Promise<Bytes> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(bytes: Bytes): Promise<Bytes> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > MAX_UNPACKED_BYTES) {
      await reader.cancel()
      throw new Error('The share is too big')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** The bytes to upload: IV, then the encrypted, compressed bundle */
export async function encryptBundle(key: string, bundle: ShareBundle): Promise<Bytes> {
  const packed = await gzip(new TextEncoder().encode(JSON.stringify(bundle)))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importKey(key), packed)
  )
  const out = new Uint8Array(IV_BYTES + cipher.length)
  out.set(iv)
  out.set(cipher, IV_BYTES)
  return out
}

/** The bundle in a downloaded file. Throws if the key is wrong, the file was changed or isn't a share. */
export async function decryptBundle(key: string, file: Bytes): Promise<ShareBundle> {
  if (file.length <= IV_BYTES) throw new Error('The share is damaged')
  const packed = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: file.slice(0, IV_BYTES) },
      await importKey(key),
      file.slice(IV_BYTES)
    )
  )
  return parseShareBundle(JSON.parse(new TextDecoder().decode(await gunzip(packed))))
}

/** https://chordless.app/s/<fileId>#<key> */
export function shareUrl(origin: string, fileId: string, key: string): string {
  return `${origin}/s/${encodeURIComponent(fileId)}#${key}`
}

/** The file id and key in a share link (a full URL, or a path and fragment), or null */
export function parseShareUrl(url: string): { fileId: string; key: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url, 'https://chordless.invalid')
  } catch {
    return null
  }
  const match = /^\/s\/([\w-]+)$/.exec(parsed.pathname)
  const key = parsed.hash.slice(1)
  if (!match || !/^[\w-]{43}$/.test(key)) return null
  return { fileId: match[1], key }
}

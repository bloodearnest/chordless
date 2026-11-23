/** A size for people to read: "340 B", "12 KB", "1.4 MB", "2.1 GB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** Bytes as lower-case hex */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

/** The SHA-256 of text (as UTF-8), in hex */
export async function sha256Hex(text: string): Promise<string> {
  return toHex(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  )
}

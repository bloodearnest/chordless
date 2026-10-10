/**
 * Hash text content (simple hash for now)
 */
export function hashText(text) {
  // Simple hash - could be upgraded to crypto.subtle.digest later
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return `hash-${Math.abs(hash).toString(16)}`
}

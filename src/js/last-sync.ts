/**
 * When a space last synced, kept on this device for each space (the one before there were several
 * kept a single time, which the space in use still reads until it syncs).
 */
import { getCurrentSpace } from './space.ts'

const LEGACY_KEY = 'last-sync-time'
const key = (spaceId: string) => `${LEGACY_KEY}:${spaceId}`

/** ISO time of the space's last sync on this device, if it has had one */
export function lastSyncOf(spaceId: string): string | null {
  const legacy = spaceId === getCurrentSpace().id ? localStorage.getItem(LEGACY_KEY) : null
  return localStorage.getItem(key(spaceId)) ?? legacy
}

/** Note that the space has just synced; returns the time */
export function recordSync(spaceId: string): string {
  const now = new Date().toISOString()
  localStorage.setItem(key(spaceId), now)
  return now
}

/** Forget a space's last sync (it was deleted from this device) */
export function forgetSync(spaceId: string): void {
  localStorage.removeItem(key(spaceId))
}

/** "Just now", "5 minutes ago", ... or the date for anything over a week */
export function formatSyncTime(isoString: string, now = new Date()): string {
  const date = new Date(isoString)
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`

  return date.toLocaleDateString()
}

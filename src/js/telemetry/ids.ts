/**
 * The id that tells one device's reports from another's (docs/OBSERVABILITY.md, Identity): a random
 * UUID, kept in localStorage, derived from nothing. It is only made once reports are on, and
 * removed when they are turned off. Support is given the first part of it, by the person.
 */

import { getTelemetryPreference } from '../preferences.ts'

const KEY = 'telemetry-device-id'

/** This device's id, made the first time it is asked for; null where storage cannot hold one */
export function getDeviceId(): string | null {
  try {
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    return null
  }
}

/** Forget the id: the next report makes a new one, which nothing links to the old */
export function resetDeviceId(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // (storage is blocked: there is no id to forget)
  }
}

/** The first part of this device's id: enough to find its reports, and short to say. Empty while reports are off */
export function supportId(): string {
  return getTelemetryPreference() ? (getDeviceId()?.slice(0, 8) ?? '') : ''
}

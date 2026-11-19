/**
 * What the Worker holds about the signed-in person's account (docs/ACCOUNT.md, "The account"): the name they gave and every
 * address they sign in with. It is read from `GET /api/account`, kept on this device so the Account page shows it offline, and
 * forgotten when they log out.
 */

import { TeamError } from './worker-call.ts'

export interface AccountInfo {
  /** The name they gave (or Google gave at a first sign-in); null if they have none yet */
  name: string | null
  /** Every address they sign in with, and how: `google` or `email` */
  emails: { email: string; provider: string }[]
  /** The address of the Google account joined to the account, if one is */
  googleEmail: string | null
  /** The Google Drive connected to the account, which any device signed in to it syncs through; null if none */
  drive?: { email: string } | null
}

let key = 'chordless:account'

/** Where the account is kept: another key for a test, since test files share a browser's storage and run at once */
export function setAccountStorageKey(next: string): void {
  key = next
}

/** The account as it was last read on this device, if it was */
export function cachedAccount(): AccountInfo | null {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null')
    return stored && Array.isArray(stored.emails) ? (stored as AccountInfo) : null
  } catch {
    return null
  }
}

function keep(info: AccountInfo): AccountInfo {
  try {
    localStorage.setItem(key, JSON.stringify(info))
  } catch {
    // (storage is blocked: it is read again next time)
  }
  return info
}

/** Forget what was kept: they logged out */
export function forgetAccount(): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // (storage is blocked: nothing was kept)
  }
}

async function call(method: 'GET' | 'PUT', body?: object): Promise<AccountInfo> {
  const { getIdentityToken } = await import('./google-auth.ts')
  const response = await fetch('/api/account', {
    method,
    headers: {
      Authorization: `Bearer ${await getIdentityToken()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const answer = await response.json().catch(() => ({}))
  // (the Worker's refusal of a request, in words for the person: a 4xx is shown, a failure of its own is not)
  if (!response.ok) throw new TeamError(answer.error || response.statusText, response.status)
  return keep(answer as AccountInfo)
}

/** Read the account from the Worker, keeping what it says; null when it cannot be (offline, or not signed in) */
export async function loadAccount(): Promise<AccountInfo | null> {
  try {
    return await call('GET')
  } catch {
    return null
  }
}

/** Set the name they give for themselves; resolves to the account as it is now, throws what the Worker said */
export function saveAccountName(name: string): Promise<AccountInfo> {
  return call('PUT', { name })
}

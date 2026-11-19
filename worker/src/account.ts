/**
 * The signed-in person's own account (docs/ACCOUNT.md, "The account"): the name they gave, and every address they sign in
 * with. `GET /api/account` says them; `PUT /api/account {name}` sets the name. Both need a Chordless session.
 */
import type { Env } from './env.ts'
import { jsonResponse, Refusal, readJson, refusing } from './http.ts'
import { authenticate, SESSION_PROVIDER, sessionProvider } from './identity.ts'

export const ACCOUNT_PATH = '/api/account'

/** The longest name kept */
export const MAX_NAME_LENGTH = 100

export interface AccountInfo {
  /** The name they gave, or Google gave when they first signed in with it; null if they have none yet */
  name: string | null
  /** Every address they sign in with, with how: `google` (the address of their Google account) or `email` (an emailed code) */
  emails: { email: string; provider: string }[]
  /** The address of the Google account joined to this account, if one is: what syncs their Personal space */
  googleEmail: string | null
}

async function whoIs(request: Request, env: Env): Promise<string> {
  const identity = await authenticate(request, [sessionProvider(env)])
  if (!identity || identity.provider !== SESSION_PROVIDER) throw new Refusal(401, 'Sign in first')
  return identity.sub
}

/** What this account holds about its person */
export async function accountInfo(env: Env, accountId: string): Promise<AccountInfo> {
  const db = env.DB as NonNullable<Env['DB']>
  const account = await db
    .prepare('SELECT name FROM accounts WHERE account_id = ?')
    .bind(accountId)
    .first<{ name: string | null }>()
  // (the addresses the account owns; and a login's own, if another account has its address, so it still shows)
  const { results: owned } = await db
    .prepare('SELECT email FROM account_emails WHERE account_id = ? ORDER BY created_at, email')
    .bind(accountId)
    .all<{ email: string }>()
  const { results: logins } = await db
    .prepare(
      'SELECT provider, email FROM account_identities WHERE account_id = ? ORDER BY created_at, provider'
    )
    .bind(accountId)
    .all<{ provider: string; email: string }>()
  const googleEmail = logins.find(row => row.provider === 'google')?.email || null
  const addresses = [
    ...new Set([...owned.map(row => row.email), ...logins.map(row => row.email)]),
  ].filter(Boolean)
  return {
    name: account?.name ?? null,
    emails: addresses.map(email => ({
      email,
      provider: email === googleEmail ? 'google' : 'email',
    })),
    googleEmail,
  }
}

/** A name as it is kept: trimmed, one space between words; undefined if it is empty or too long */
export function cleanName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const name = value.replace(/\s+/g, ' ').trim()
  return name && name.length <= MAX_NAME_LENGTH ? name : undefined
}

/** GET and PUT /api/account */
export function handleAccount(request: Request, env: Env): Promise<Response> {
  return refusing(async () => {
    if (!env.DB || !env.SESSION_SIGNING_KEY) return jsonResponse({ error: 'Not set up' }, 503)
    const accountId = await whoIs(request, env)
    if (request.method === 'PUT') {
      const name = cleanName((await readJson(request)).name)
      if (!name) return jsonResponse({ error: 'A name is needed' }, 400)
      await env.DB.prepare('UPDATE accounts SET name = ? WHERE account_id = ?')
        .bind(name, accountId)
        .run()
    }
    return jsonResponse(await accountInfo(env, accountId), 200)
  })
}

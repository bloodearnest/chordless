/**
 * Signing in with an emailed code, for someone with no Google account (docs/SPACES.md, "Signing in without
 * Google"). Two routes: `/session/email/start` mails a six-digit code, `/session/email/verify` takes it and
 * answers with a Chordless session (session-tokens.ts), as a sign-in with Google does.
 *
 * The answer to `start` is the same for any address that is one, so it does not say whether an account exists.
 * `login_codes` (migrations 0005, 0006) holds keyed hashes to check a typed code and the limits, and, for the
 * link in the email (`/sign-in/<id>`), the address and code themselves until they are used or have run out. A code
 * works once, for three days, for five tries; five codes an hour go to one address, and a sender (by its
 * address) is limited too, so that Chordless cannot be used to fill someone's inbox.
 *
 * An address that has been proved is a login of provider `email` (the address is its `sub`). If a Google login
 * of the same address is on an account, the address joins that account: the same mailbox is the same person
 * (an invitation's address never does this: it is a label, not proof).
 */
import { toBase64Url } from '../../src/js/base64url.ts'
import { sha256Hex } from '../../src/js/utils/bytes.ts'
import type { D1Db } from './d1.ts'
import type { Env } from './env.ts'
import { jsonResponse, readJson, refusing } from './http.ts'
import { issueSession } from './session-tokens.ts'
import { accountOf } from './team-state.ts'
import { annotateRequest } from './trace.ts'

/** Who the code comes from: Email Sending is enabled on this subdomain (infra/cloudflare) */
export const LOGIN_SENDER = { email: 'signin@mail.chordless.app', name: 'Chordless' }

/** How long a code and its link work: an email may wait in an inbox, and none of this is very sensitive */
export const CODE_TTL_MS = 3 * 24 * 60 * 60 * 1000
export const MAX_TRIES = 5
export const MAX_CODES_PER_HOUR = 5
const HOUR_MS = 60 * 60 * 1000

export const EMAIL_PROVIDER = 'email'

/** A keyed hash, so that a leaked table cannot be searched for addresses or codes */
const hashed = (env: Env, ...parts: string[]) =>
  sha256Hex([env.SESSION_SIGNING_KEY, ...parts].join('\n'))

/** An address as it is compared: trimmed, lower case; undefined if it is not one */
export function cleanAddress(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const address = value.trim().toLowerCase()
  return address.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? address : undefined
}

/** Six digits, each equally likely */
function newCode(): string {
  const limit = 4_294_967_296 - (4_294_967_296 % 1_000_000)
  const word = new Uint32Array(1)
  do crypto.getRandomValues(word)
  while (word[0] >= limit)
  return String(word[0] % 1_000_000).padStart(6, '0')
}

/** A page of the app to come back to, as a path: not another site, and not an address with a scheme */
export function cleanNext(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 300 && /^\/(?![/\\])\S*$/.test(value)
    ? value
    : undefined
}

/** The link in the email: the page that signs in with it, and an id that means nothing but this row (`login_codes`) */
export function loginLink(origin: string, id: string): string {
  return `${origin}/sign-in/${id}`
}

/** A new id for a link: 128 random bits */
function newLinkId(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(16)))
}

/**
 * The email: short and plain. One message with both ways in: the link (one tap, on the device that opens it) and
 * the code (typed, for a device whose mail app opens links somewhere else, such as an installed app on iOS).
 * The code is in the subject too, so that it shows without opening.
 */
export function loginEmail(code: string, link: string) {
  return {
    subject: `Your Chordless sign-in code: ${code}`,
    text: `Sign in to Chordless by opening this link on the device you want to sign in on:

${link}

Or, if the link does not open in the right place, enter this code in Chordless:

${code}

Either works once, for 3 days (a new code replaces the old one). If you did not ask for this, ignore it: nothing happens unless the link is opened or the code is entered.
`,
  }
}

/**
 * Whether this sender may ask, and the Worker as a whole may send: a sender (by its address) is limited, and
 * so is everyone together, since a sender that changes address, asking for codes for addresses that do not
 * exist, would otherwise fill the domain's name with bounces.
 */
async function allowed(request: Request, env: Env): Promise<boolean> {
  try {
    const key = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    if (env.EMAIL_LOGIN && (await env.EMAIL_LOGIN.limit({ key })).success === false) return false
    return (
      !env.EMAIL_LOGIN_OVERALL ||
      (await env.EMAIL_LOGIN_OVERALL.limit({ key: 'all' })).success !== false
    )
  } catch {
    // (a limit that cannot be asked is no reason to refuse)
    return true
  }
}

/**
 * POST /session/email/start { address, next? }
 *
 * Mails a code and a link that signs in with it (`next` is the page, a path of the app, the link goes on to). The
 * address, the code and `next` are kept in the row the link's id names, until they are used or have run out. 200 `{ok: true}` whether or not the address has had codes before, and also when it has had
 * its five this hour (nothing more is sent); 400 for text that is not an address; 429 for a sender asking
 * too often; 502 if the mail could not be handed over; 503 where the Worker cannot send.
 */
export function handleEmailStart(
  request: Request,
  env: Env,
  now: Date = new Date()
): Promise<Response> {
  return refusing(async () => {
    const body = await readJson(request)
    const address = cleanAddress(body.address)
    if (!address) return jsonResponse({ error: 'invalid_address' }, 400)
    const next = cleanNext(body.next)
    if (!env.DB || !env.EMAIL) return jsonResponse({ error: 'Email sign-in is not set up' }, 503)
    if (!(await allowed(request, env))) {
      annotateRequest({ 'chordless.auth.email_result': 'sender_limited' })
      return jsonResponse({ error: 'too_many' }, 429)
    }

    const key = await hashed(env, 'address', address)
    const row = await env.DB.prepare(
      'SELECT window_start, sent FROM login_codes WHERE address_hash = ?'
    )
      .bind(key)
      .first<{ window_start: string; sent: number }>()
    const at = now.toISOString()
    const inWindow = !!row && now.getTime() - Date.parse(row.window_start) < HOUR_MS
    if (row && inWindow && row.sent >= MAX_CODES_PER_HOUR) {
      annotateRequest({ 'chordless.auth.email_result': 'address_limited' })
      return jsonResponse({ ok: true })
    }

    const code = newCode()
    const id = newLinkId()
    // (what has run out goes, so addresses do not stay in a table that has no other reason to keep them)
    await env.DB.prepare('DELETE FROM login_codes WHERE expires_at < ?').bind(at).run()
    await env.DB.prepare(
      `INSERT INTO login_codes (address_hash, code_hash, created_at, expires_at, attempts, window_start, sent,
          link_hash, address, code, next)
        VALUES (?, ?, ?, ?, 0, ?, 1, ?, ?, ?, ?)
        ON CONFLICT (address_hash) DO UPDATE SET code_hash = excluded.code_hash, created_at = excluded.created_at,
          expires_at = excluded.expires_at, attempts = 0,
          window_start = CASE WHEN ? THEN window_start ELSE excluded.window_start END,
          sent = CASE WHEN ? THEN sent + 1 ELSE 1 END,
          link_hash = excluded.link_hash, address = excluded.address, code = excluded.code, next = excluded.next`
    )
      .bind(
        key,
        await hashed(env, 'code', address, code),
        at,
        new Date(now.getTime() + CODE_TTL_MS).toISOString(),
        at,
        await hashed(env, 'link', id),
        address,
        code,
        next ?? null,
        inWindow ? 1 : 0,
        inWindow ? 1 : 0
      )
      .run()

    try {
      await env.EMAIL.send({
        to: address,
        from: LOGIN_SENDER,
        ...loginEmail(code, loginLink(new URL(request.url).origin, id)),
      })
    } catch (error) {
      annotateRequest({
        'chordless.auth.email_result': 'send_failed',
        'chordless.auth.email_error': String((error as { code?: string }).code ?? 'unknown'),
      })
      return jsonResponse({ error: 'send_failed' }, 502)
    }
    annotateRequest({ 'chordless.auth.email_result': 'sent' })
    return jsonResponse({ ok: true })
  })
}

/** The account of a proved address: the one that owns it, else a new one that now does (`accountOf`) */
export async function accountOfMailbox(db: D1Db, address: string, now: Date): Promise<string> {
  return (await accountOf(
    db,
    { provider: EMAIL_PROVIDER, sub: address, email: address },
    true,
    now
  )) as string
}

/**
 * POST /session/email/verify { address, code }
 *
 * A session for the account of the address, as `/session/token` answers (`{access_token, refresh_token,
 * expires_in}`) with the address added. 401 `invalid_code` with a `reason`: `wrong` (tries are counted),
 * `expired` (none was asked for, it has ended, or it was used), or `too_many` (five wrong ones: ask again).
 */
export function handleEmailVerify(
  request: Request,
  env: Env,
  now: Date = new Date()
): Promise<Response> {
  return refusing(async () => {
    const body = await readJson(request)
    const address = cleanAddress(body.address)
    const code = typeof body.code === 'string' ? body.code.replace(/\s/g, '') : ''
    if (!address || !/^\d{6}$/.test(code))
      return jsonResponse({ error: 'invalid_code', reason: 'wrong' }, 401)
    if (!env.DB) return jsonResponse({ error: 'Email sign-in is not set up' }, 503)

    const refused = (reason: 'wrong' | 'expired' | 'too_many') => {
      annotateRequest({ 'chordless.auth.email_result': reason })
      return jsonResponse({ error: 'invalid_code', reason }, 401)
    }
    const key = await hashed(env, 'address', address)
    const row = await env.DB.prepare(
      'SELECT code_hash, expires_at, attempts FROM login_codes WHERE address_hash = ?'
    )
      .bind(key)
      .first<{ code_hash: string; expires_at: string; attempts: number }>()
    if (!row || row.expires_at <= now.toISOString()) return refused('expired')
    if (row.attempts >= MAX_TRIES) return refused('too_many')

    const given = await hashed(env, 'code', address, code)
    if (given !== row.code_hash) {
      await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE address_hash = ?')
        .bind(key)
        .run()
      return refused(row.attempts + 1 >= MAX_TRIES ? 'too_many' : 'wrong')
    }
    // (once: of two requests with the right code, the one that deletes it signs in)
    const used = await env.DB.prepare(
      'DELETE FROM login_codes WHERE address_hash = ? AND code_hash = ?'
    )
      .bind(key, given)
      .run()
    if (used.meta.changes === 0) return refused('expired')

    const accountId = await accountOfMailbox(env.DB, address, now)
    const session = await issueSession(env.DB, env, { accountId, email: address }, now)
    annotateRequest({ 'chordless.auth.email_result': 'signed_in' })
    return jsonResponse({ ...session, email: address })
  })
}

interface LinkRow {
  address_hash: string
  address: string
  code: string
  next: string | null
  expires_at: string
}

/** The row a link's id names, if it has not run out */
async function linkRow(env: Env, id: unknown, now: Date): Promise<LinkRow | null> {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(id) || !env.DB) return null
  const row = await env.DB.prepare(
    'SELECT address_hash, address, code, next, expires_at FROM login_codes WHERE link_hash = ?'
  )
    .bind(await hashed(env, 'link', id))
    .first<LinkRow>()
  return row && row.address && row.expires_at > now.toISOString() ? row : null
}

/**
 * POST /session/email/link { id }
 *
 * Signs in with the link in the email: a session for the address it was sent to, as `/session/email/verify`
 * answers, with the page to go on to (`next`). The link and the code are one row: using either ends both. 401
 * `invalid_link` for an id that is not one, has been used, was replaced by a newer code, or has run out.
 */
export function handleEmailLink(
  request: Request,
  env: Env,
  now: Date = new Date()
): Promise<Response> {
  return refusing(async () => {
    if (!env.DB) return jsonResponse({ error: 'Email sign-in is not set up' }, 503)
    const row = await linkRow(env, (await readJson(request)).id, now)
    if (!row) {
      annotateRequest({ 'chordless.auth.email_result': 'link_expired' })
      return jsonResponse({ error: 'invalid_link' }, 401)
    }
    // (once: of two requests with the link, the one that deletes the row signs in)
    const used = await env.DB.prepare('DELETE FROM login_codes WHERE address_hash = ? AND code = ?')
      .bind(row.address_hash, row.code)
      .run()
    if (used.meta.changes === 0) return jsonResponse({ error: 'invalid_link' }, 401)
    const accountId = await accountOfMailbox(env.DB, row.address, now)
    const session = await issueSession(env.DB, env, { accountId, email: row.address }, now)
    annotateRequest({ 'chordless.auth.email_result': 'link_signed_in' })
    return jsonResponse({ ...session, email: row.address, next: row.next ?? '/' })
  })
}

/**
 * POST /session/email/link/peek { id }
 *
 * What the link is for, without using it up: the address and the code, for a person whose link opened in a browser
 * that is not the app they are signing in to (an installed app on iOS has storage apart from Safari's) and who
 * enters the code in the app instead. The id is as good as the code for signing in, so this gives away nothing more.
 */
export function handleEmailLinkPeek(
  request: Request,
  env: Env,
  now: Date = new Date()
): Promise<Response> {
  return refusing(async () => {
    if (!env.DB) return jsonResponse({ error: 'Email sign-in is not set up' }, 503)
    const row = await linkRow(env, (await readJson(request)).id, now)
    if (!row) return jsonResponse({ error: 'invalid_link' }, 401)
    return jsonResponse({ address: row.address, code: row.code, next: row.next ?? '/' })
  })
}

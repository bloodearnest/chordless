/**
 * The email that invites someone to a team space (docs/SPACES.md, "Invites"): sent when an admin makes the invite,
 * to the address it is for, with the link in it. An invite is still made, and its link still shown, when the mail
 * cannot be sent or is held back by a limit: the person who made it can pass it on themselves.
 *
 * Chordless can be pointed at any address by anyone who runs a team, so this is limited: the invites an address
 * has had in the last hour (whichever team made them), the one who invites (by address), and everyone together
 * (the same limit as for sign-in codes, since bounces from addresses that do not exist hurt every mail Chordless sends).
 */

import type { MemberRole } from '../../src/js/team-roles.ts'
import type { D1Db } from './d1.ts'
import type { Env } from './env.ts'
import type { Identity } from './identity.ts'
import { annotateRequest } from './trace.ts'

/** Who invitations come from: the same Email Sending subdomain as the sign-in codes (infra/cloudflare) */
export const INVITE_SENDER = { email: 'invites@mail.chordless.app', name: 'Chordless' }

/** Invites to one address in an hour, from all teams, before nothing more is mailed to it */
export const MAX_INVITES_PER_ADDRESS_PER_HOUR = 3

const ROLES: Record<MemberRole, string> = {
  admin: 'an admin',
  writer: 'a worship leader',
  reader: 'a team member',
}

export interface InviteEmailInput {
  /** Where the page is (links point here) */
  origin: string
  spaceId: string
  teamName: string
  role: MemberRole
  /** Who the invite is for, and who made it */
  to: string
  by: Identity
  code: string
}

/** The link that opens the invite: /join/<space id>/<code> */
export function inviteUrl(origin: string, spaceId: string, code: string): string {
  return `${origin}/join/${encodeURIComponent(spaceId)}/${encodeURIComponent(code)}`
}

/** The email: plain, with the link, and what it asks of the person (an admin invite is for this address alone) */
export function inviteEmail({ origin, spaceId, teamName, role, to, by, code }: InviteEmailInput) {
  const link = inviteUrl(origin, spaceId, code)
  // (a name someone chose goes into the text, not into any header)
  const team = teamName.replace(/\s+/g, ' ').trim()
  const lines = [
    `${by.email} invited you to join ${team} on Chordless as ${ROLES[role]}.`,
    '',
    'Open this link to join:',
    '',
    link,
    '',
    role === 'admin'
      ? `An admin invite only works with this address, ${to}: sign in with it, by a code Chordless emails to ${to} or with a Google account that has it.`
      : `Sign in with your email address or a Google account: it does not have to be ${to}.`,
    '',
    'The link works once, for a week. If you do not know who this is, ignore it: nothing happens unless the link is opened.',
    '',
  ]
  return { subject: `Join ${team} on Chordless`, text: lines.join('\n') }
}

async function allowed(env: Env, to: string, by: Identity, now: Date): Promise<boolean> {
  try {
    if (
      env.EMAIL_LOGIN &&
      (await env.EMAIL_LOGIN.limit({ key: `invite:${by.email}` })).success === false
    ) {
      return false
    }
    if (
      env.EMAIL_LOGIN_OVERALL &&
      (await env.EMAIL_LOGIN_OVERALL.limit({ key: 'all' })).success === false
    ) {
      return false
    }
  } catch {
    // (a limit that cannot be asked is no reason to refuse)
  }
  const since = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
  const row = await (env.DB as D1Db)
    .prepare('SELECT COUNT(*) AS n FROM team_invites WHERE email = ? AND created_at > ?')
    .bind(to, since)
    .first<{ n: number }>()
  // (the invite just made is one of them)
  return (row as { n: number }).n <= MAX_INVITES_PER_ADDRESS_PER_HOUR
}

/** Mail the invite; whether it was handed over (false: held back by a limit, or could not be sent) */
export async function sendInviteEmail(
  env: Env,
  input: InviteEmailInput,
  now: Date = new Date()
): Promise<boolean> {
  if (!env.EMAIL || !env.DB) return false
  if (!(await allowed(env, input.to, input.by, now))) {
    annotateRequest({ 'chordless.invite.email': 'held_back' })
    return false
  }
  try {
    await env.EMAIL.send({
      to: input.to,
      from: INVITE_SENDER,
      replyTo: input.by.email,
      ...inviteEmail(input),
    })
  } catch (error) {
    annotateRequest({
      'chordless.invite.email': 'send_failed',
      'chordless.invite.email_error': String((error as { code?: string }).code ?? 'unknown'),
    })
    return false
  }
  annotateRequest({ 'chordless.invite.email': 'sent' })
  return true
}

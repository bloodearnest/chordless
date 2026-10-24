/**
 * The Node side of the real-Drive suite (docs/DRIVE_TESTS.md): where its access token comes from,
 * and what the person running it asked for. The browser tests reach it through the commands the
 * runner config (web-test-runner.drive.config.js) serves.
 *
 * The suite holds a refresh token for a test Google account as a long-term secret, in the
 * environment (`.drive-test.env`, which git ignores). Each run starts by minting an access token
 * from it, or reusing the last one while it has time left; neither is ever printed.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DriveSuiteSettings } from './settings.ts'

export interface DriveTestCredentials {
  clientId: string
  clientSecret: string
  refreshToken: string
}

/** The variables the credentials are read from */
export const CREDENTIAL_VARIABLES = {
  clientId: 'DRIVE_TEST_CLIENT_ID',
  clientSecret: 'DRIVE_TEST_CLIENT_SECRET',
  refreshToken: 'DRIVE_TEST_REFRESH_TOKEN',
} as const

/** The credentials, or the names of the variables that are not set */
export function credentialsFromEnv(
  env: Record<string, string | undefined>
): { credentials: DriveTestCredentials } | { missing: string[] } {
  const missing = Object.values(CREDENTIAL_VARIABLES).filter(name => !env[name])
  if (missing.length > 0) return { missing }
  return {
    credentials: {
      clientId: env[CREDENTIAL_VARIABLES.clientId] as string,
      clientSecret: env[CREDENTIAL_VARIABLES.clientSecret] as string,
      refreshToken: env[CREDENTIAL_VARIABLES.refreshToken] as string,
    },
  }
}

export interface MintedToken {
  accessToken: string
  /** Epoch milliseconds */
  expiresAt: number
}

/** Ask Google for an access token in exchange for the refresh token */
export async function mintAccessToken(
  credentials: DriveTestCredentials,
  { fetch: doFetch = fetch, now = Date.now }: { fetch?: typeof fetch; now?: () => number } = {}
): Promise<MintedToken> {
  const response = await doFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
    }),
  })
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }
  if (!response.ok || !body.access_token) {
    // (Google's reason, never the credentials)
    throw new Error(
      `Google would not give an access token (${response.status} ${body.error ?? ''}): ${body.error_description ?? 'check the refresh token and client'}`
    )
  }
  return { accessToken: body.access_token, expiresAt: now() + (body.expires_in ?? 3600) * 1000 }
}

/** Reuse a token while it has this long left */
const MIN_LIFE_MS = 5 * 60 * 1000

interface CachedToken extends MintedToken {
  /** Which refresh token it was minted from (a hash), so changing credentials does not reuse it */
  for: string
}

/**
 * Where access tokens come from: the file the last run left while its token has time left, or a
 * new one (which is then kept for the next run, readable by this user only).
 */
export function accessTokens(
  credentials: DriveTestCredentials,
  {
    cachePath,
    fetch: doFetch,
    now = Date.now,
  }: { cachePath?: string; fetch?: typeof fetch; now?: () => number } = {}
): () => Promise<string> {
  const owner = createHash('sha256').update(credentials.refreshToken).digest('hex')
  let current: MintedToken | undefined
  if (cachePath) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as CachedToken
      if (cached.for === owner) current = cached
    } catch {
      // (none yet, or unreadable: mint one)
    }
  }
  let minting: Promise<MintedToken> | undefined

  return async () => {
    if (current && current.expiresAt - now() > MIN_LIFE_MS) return current.accessToken
    // (several tests ask at once: one request)
    minting ??= mintAccessToken(credentials, { fetch: doFetch, now }).finally(() => {
      minting = undefined
    })
    current = await minting
    if (cachePath) {
      mkdirSync(dirname(cachePath), { recursive: true })
      writeFileSync(cachePath, JSON.stringify({ ...current, for: owner }), { mode: 0o600 })
    }
    return current.accessToken
  }
}

/** "1-5", "3,9" or "1-3,8": the seeds to run */
export function parseSeeds(text: string | undefined, fallback: number[]): number[] {
  if (!text?.trim()) return fallback
  const seeds: number[] = []
  for (const part of text.split(',')) {
    const range = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(part)
    if (range) {
      for (let seed = Number(range[1]); seed <= Number(range[2]); seed++) seeds.push(seed)
    } else if (/^\s*\d+\s*$/.test(part)) seeds.push(Number(part))
    else throw new Error(`DRIVE_SEEDS: cannot read "${part.trim()}" (use 3, 1-5 or 1-3,8)`)
  }
  return seeds
}

export function settingsFromEnv(env: Record<string, string | undefined>): DriveSuiteSettings {
  const number = (name: string, fallback: number) => {
    const value = env[name]?.trim()
    if (!value) return fallback
    if (!/^\d+$/.test(value)) throw new Error(`${name}: "${value}" is not a number`)
    return Number(value)
  }
  return {
    seeds: parseSeeds(env.DRIVE_SEEDS, [1, 2, 3]),
    steps: number('DRIVE_STEPS', 30),
    devices: number('DRIVE_DEVICES', 3),
    modes: (env.DRIVE_MODES ?? 'owner,concurrent')
      .split(',')
      .map(mode => mode.trim())
      .filter(Boolean),
  }
}

/** The address that asks the test account to let the suite use its Drive (the loopback login, scripts/drive-test-login.ts) */
export function consentUrl(options: {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
  /** The account to sign in as, filled in on Google's page */
  loginHint?: string
}): string {
  const query = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    // (the scope the app asks for: files it made itself, which is all the suite makes)
    scope: 'https://www.googleapis.com/auth/drive.file',
    // (a refresh token is only given with offline access, and again only on consent)
    access_type: 'offline',
    prompt: 'consent',
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: 'S256',
    ...(options.loginHint && { login_hint: options.loginHint }),
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`
}

/** An env file's text with a variable set (replacing the line it has, or added) */
export function withEnvVariable(envText: string, name: string, value: string): string {
  const line = `${name}=${value}`
  const pattern = new RegExp(`^${name}=.*$`, 'm')
  if (pattern.test(envText)) return envText.replace(pattern, () => line)
  return `${envText}${envText === '' || envText.endsWith('\n') ? '' : '\n'}${line}\n`
}

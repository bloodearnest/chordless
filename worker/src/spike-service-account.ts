/**
 * THROWAWAY, for the spike in docs/SPACES.md ("Spike first", item 7): can a service account, made a
 * member of the shared drive, do everything the Worker needs in a team folder, with no owner's token?
 * Dev only: the router answers 404 unless DEV_PAGES is set.
 *
 * POST /dev/spike/service { folderId } signs a JWT with the key in SPIKE_SERVICE_ACCOUNT_KEY,
 * exchanges it at Google for an access token, and tries each operation in the folder, answering
 * with one row per step. It cleans up after itself, apart from the trashed test file.
 */

import type { Env } from './env.ts'
import { jsonResponse, message } from './http.ts'

const DRIVE = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const ALL_DRIVES = 'supportsAllDrives=true'
const SCOPE = 'https://www.googleapis.com/auth/drive'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

type Fetcher = typeof fetch

interface ServiceAccountKey {
  client_email: string
  private_key: string
  token_uri?: string
}

/** One thing tried: what, whether it did what was expected, and what Google said */
interface Step {
  step: string
  ok: boolean
  detail: string
}

const base64Url = (bytes: ArrayBuffer | Uint8Array | string) => {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes)
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** The signed request for an access token (RS256, signed with WebCrypto) */
export async function signServiceAccountJwt(key: ServiceAccountKey, now = Date.now()) {
  const pem = key.private_key.replace(/-----[A-Z ]+-----|\s/g, '')
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const iat = Math.floor(now / 1000)
  const unsigned = `${base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64Url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPE,
      aud: key.token_uri ?? TOKEN_URL,
      iat,
      exp: iat + 3600,
    })
  )}`
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(unsigned)
  )
  return `${unsigned}.${base64Url(signature)}`
}

/** What Google said, short enough to read in a table */
async function said(response: Response) {
  const text = await response.text()
  return `HTTP ${response.status} ${text.slice(0, 200)}`
}

/** POST /dev/spike/service: { folderId } -> { account, steps } */
export async function handleSpikeService(request: Request, env: Env, fetcher: Fetcher = fetch) {
  const { folderId } = (await request.json()) as { folderId?: string }
  if (!folderId) return jsonResponse({ error: 'Missing folderId' }, 400)
  if (!env.SPIKE_SERVICE_ACCOUNT_KEY) {
    return jsonResponse({ error: 'SPIKE_SERVICE_ACCOUNT_KEY is not set in .dev.vars' }, 500)
  }
  let key: ServiceAccountKey
  try {
    key = JSON.parse(env.SPIKE_SERVICE_ACCOUNT_KEY)
  } catch {
    return jsonResponse(
      { error: 'SPIKE_SERVICE_ACCOUNT_KEY is not JSON (one line, in quotes)' },
      500
    )
  }

  const steps: Step[] = []
  const add = (step: string, ok: boolean, detail: string) => steps.push({ step, ok, detail })

  let token: string
  try {
    const grant = await fetcher(key.token_uri ?? TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: await signServiceAccountJwt(key),
      }),
    })
    if (!grant.ok) {
      add('get an access token with the drive scope', false, await said(grant))
      return jsonResponse({ account: key.client_email, steps })
    }
    token = ((await grant.json()) as { access_token: string }).access_token
    add('get an access token with the drive scope', true, 'signed a JWT; Google gave a token')
  } catch (error) {
    add('get an access token with the drive scope', false, message(error))
    return jsonResponse({ account: key.client_email, steps })
  }

  const auth = { Authorization: `Bearer ${token}` }
  const folder = `${DRIVE}/files/${encodeURIComponent(folderId)}`

  const meta = await fetcher(
    `${folder}?${ALL_DRIVES}&fields=id,name,driveId,capabilities(canAddChildren,canTrash,canDelete)`,
    { headers: auth }
  )
  add('read the team folder', meta.ok, await said(meta))
  if (!meta.ok) return jsonResponse({ account: key.client_email, steps })

  const query = encodeURIComponent(`'${folderId}' in parents and trashed=false`)
  const list = await fetcher(
    `${DRIVE}/files?q=${query}&fields=files(id,name)&${ALL_DRIVES}&includeItemsFromAllDrives=true`,
    { headers: auth }
  )
  const listed = await said(list)
  add('list what is in it (the files the app made as the owner, too)', list.ok, listed)

  const boundary = `spike-${crypto.randomUUID()}`
  const created = await fetcher(
    `${UPLOAD}/files?uploadType=multipart&fields=id,name&${ALL_DRIVES}`,
    {
      method: 'POST',
      headers: { ...auth, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body:
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify({ name: 'spike-service-account.txt', parents: [folderId] })}` +
        `\r\n--${boundary}\r\nContent-Type: text/plain\r\n\r\nmade by the service account\r\n--${boundary}--`,
    }
  )
  if (!created.ok) {
    add('create a file in it', false, await said(created))
    return jsonResponse({ account: key.client_email, steps })
  }
  const fileId = ((await created.json()) as { id: string }).id
  add('create a file in it', true, `made ${fileId}`)

  const file = `${DRIVE}/files/${encodeURIComponent(fileId)}`
  const read = await fetcher(`${file}?alt=media&${ALL_DRIVES}`, { headers: auth })
  const text = await read.text()
  add(
    'read it back',
    read.ok && text === 'made by the service account',
    `HTTP ${read.status} ${text}`
  )

  const update = await fetcher(
    `${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media&${ALL_DRIVES}`,
    {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'text/plain' },
      body: 'changed by the service account',
    }
  )
  add('replace its content', update.ok, await said(update))

  const trash = await fetcher(`${file}?${ALL_DRIVES}`, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  })
  add('trash it', trash.ok, await said(trash))

  // As a Content manager it cannot delete for good (spike, 2026-10-19), and the app only trashes
  const remove = await fetcher(`${file}?${ALL_DRIVES}`, { method: 'DELETE', headers: auth })
  add(
    'delete it for good (expect refused for a Content manager; allowed for a Manager)',
    true,
    await said(remove)
  )

  return jsonResponse({ account: key.client_email, steps })
}

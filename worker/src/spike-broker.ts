/**
 * THROWAWAY, for the spike in docs/SPACES.md ("Spike first", item 1 and a start on item 4): can the
 * Worker serve a second person the files in the owner's team folder with the owner's token?
 * Dev only: the router answers 404 unless DEV_PAGES is set, so it is never in production.
 *
 * - POST /dev/spike/enable: the owner hands the Worker their token blob and a folder, with the
 *   people who may use it and their role (reader or writer). The blob stays in this isolate's
 *   memory, and is lost when the dev server restarts. Nothing is written anywhere.
 * - POST /dev/spike/drive: a member, with their own Google ID token, asks for one of a few things
 *   in that folder. The Worker checks who they are and their role, and does it with the owner's
 *   access token. Content is streamed through, never kept.
 *
 * What the real thing adds (docs/SPACES.md): a Durable Object per space instead of memory, the
 * owner's consent flow, invites, admin roles, the pad rules, and a test that no content is stored.
 */

import { decryptBlob } from './blob.ts'
import type { Env } from './env.ts'
import { jsonResponse, message } from './http.ts'
import { type GoogleApi, realGoogle } from './session.ts'

export type SpikeRole = 'reader' | 'writer'

interface Space {
  folderId: string
  refreshToken: string
  members: Map<string, SpikeRole>
  access: { token: string; expiresAt: number } | null
}

/** The spaces the owners have enabled, by id (memory only: this is a spike) */
const spaces = new Map<string, Space>()

/** Forget every space (for the tests) */
export function forgetSpikeSpaces() {
  spaces.clear()
}

const DRIVE = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const ALL_DRIVES = 'supportsAllDrives=true'
/** How far up from a file the folder is looked for (a team folder is songs/ or setlists/ deep) */
const MAX_DEPTH = 6

type Fetcher = typeof fetch

/** The owner's access token, refreshed when it is about to run out */
async function ownerToken(space: Space, env: Env, google: GoogleApi): Promise<string> {
  if (space.access && space.access.expiresAt - Date.now() > 60_000) return space.access.token
  const { access_token, expires_in } = await google.refreshAccessToken(space.refreshToken, env)
  space.access = { token: access_token, expiresAt: Date.now() + (expires_in ?? 3000) * 1000 }
  return access_token
}

/** Whether a file is in the space's folder, or in a folder inside it */
async function isInside(space: Space, fileId: string, token: string, fetcher: Fetcher) {
  let id: string | undefined = fileId
  for (let depth = 0; depth <= MAX_DEPTH && id; depth++) {
    if (id === space.folderId) return true
    const response = await fetcher(
      `${DRIVE}/files/${encodeURIComponent(id)}?fields=parents&${ALL_DRIVES}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    )
    if (!response.ok) return false
    id = ((await response.json()) as { parents?: string[] }).parents?.[0]
  }
  return false
}

/** POST /dev/spike/enable: { blob, id_token, folderId, members: [{ email, role }] } -> { spaceId } */
export async function handleSpikeEnable(
  request: Request,
  env: Env,
  google: GoogleApi = realGoogle
) {
  const { blob, id_token, folderId, members } = (await request.json()) as {
    blob?: string
    id_token?: string
    folderId?: string
    members?: { email?: string; role?: string }[]
  }
  if (!blob || !id_token || !folderId || !Array.isArray(members)) {
    return jsonResponse({ error: 'Missing blob, id_token, folderId or members' }, 400)
  }
  const blobData = await decryptBlob(blob, env)
  const claims = await google.verifyIdToken(id_token, env)
  // Only the owner of the token can hand it over
  if (blobData.owner_email !== claims.email || blobData.owner_sub !== claims.sub) {
    return jsonResponse({ error: 'The blob is not yours' }, 403)
  }

  const roles = new Map<string, SpikeRole>()
  for (const member of members) {
    if (!member.email || (member.role !== 'reader' && member.role !== 'writer')) {
      return jsonResponse({ error: 'Each member needs an email and a role: reader or writer' }, 400)
    }
    roles.set(member.email.toLowerCase(), member.role)
  }
  const spaceId = crypto.randomUUID()
  spaces.set(spaceId, {
    folderId,
    refreshToken: blobData.refresh_token,
    members: roles,
    access: null,
  })
  return jsonResponse({ spaceId })
}

/**
 * POST /dev/spike/drive: { spaceId, id_token, op, fileId?, name?, content? }
 * - list: the files in the folder
 * - get: one file's metadata (inside the folder only)
 * - read: one file's content, streamed (inside the folder only)
 * - create: a text file in the folder (a writer only)
 */
export async function handleSpikeDrive(
  request: Request,
  env: Env,
  google: GoogleApi = realGoogle,
  fetcher: Fetcher = fetch
) {
  const body = (await request.json()) as {
    spaceId?: string
    id_token?: string
    op?: string
    fileId?: string
    name?: string
    content?: string
  }
  const space = body.spaceId ? spaces.get(body.spaceId) : undefined
  if (!space || !body.id_token) return jsonResponse({ error: 'No such space, or no ID token' }, 404)

  let email: string
  try {
    email = String((await google.verifyIdToken(body.id_token, env)).email ?? '').toLowerCase()
  } catch (error) {
    return jsonResponse({ error: 'Not signed in', details: message(error) }, 401)
  }
  const role = space.members.get(email)
  if (!role) return jsonResponse({ error: 'Not a member of this space' }, 403)

  const token = await ownerToken(space, env, google)
  const auth = { Authorization: `Bearer ${token}` }
  const fileId = body.fileId ?? ''

  if (body.op === 'list') {
    const query = encodeURIComponent(`'${space.folderId}' in parents and trashed=false`)
    const response = await fetcher(
      `${DRIVE}/files?q=${query}&spaces=drive&fields=files(id,name,mimeType,size)&${ALL_DRIVES}&includeItemsFromAllDrives=true`,
      { headers: auth }
    )
    return jsonResponse(await response.json(), response.status)
  }

  if (body.op === 'get' || body.op === 'read') {
    if (!fileId || !(await isInside(space, fileId, token, fetcher))) {
      return jsonResponse({ error: 'That file is not in this space' }, 403)
    }
    const media = body.op === 'read' ? '&alt=media' : '&fields=id,name,mimeType,size,parents'
    const response = await fetcher(
      `${DRIVE}/files/${encodeURIComponent(fileId)}?${ALL_DRIVES}${media}`,
      { headers: auth }
    )
    // The body goes through as it arrives: the Worker keeps none of it
    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') ?? 'application/octet-stream',
      },
    })
  }

  if (body.op === 'create') {
    if (role !== 'writer') return jsonResponse({ error: 'A reader cannot write' }, 403)
    if (!body.name) return jsonResponse({ error: 'Missing name' }, 400)
    const boundary = `spike-${crypto.randomUUID()}`
    const metadata = JSON.stringify({ name: body.name, parents: [space.folderId] })
    const response = await fetcher(
      `${UPLOAD}/files?uploadType=multipart&fields=id,name&${ALL_DRIVES}`,
      {
        method: 'POST',
        headers: { ...auth, 'Content-Type': `multipart/related; boundary=${boundary}` },
        body:
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}` +
          `\r\n--${boundary}\r\nContent-Type: text/plain\r\n\r\n${body.content ?? ''}\r\n--${boundary}--`,
      }
    )
    return jsonResponse(await response.json(), response.status)
  }

  return jsonResponse({ error: 'Unknown op' }, 400)
}

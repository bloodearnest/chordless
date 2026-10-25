/**
 * The team space API's context (team-api.ts) as the Worker has it: who is asking (the identity
 * providers), their role (the space's Durable Object), the space's Drive (the owner's access token,
 * team-drive.ts) with the refs it shows noted (team-refs.ts), and what is in the space's tree.
 *
 * The ID token is checked before any Durable Object is touched, so only signed-in accounts can
 * ask for one; a stranger and a space that is not there get the same answer (docs/SECURITY.md,
 * "Probing for team spaces").
 */
import { decryptBlob } from './blob.ts'
import type { Env } from './env.ts'
import { type GoogleApi, realGoogle } from './google-auth.ts'
import { authenticate, googleProvider, type IdentityProvider } from './identity.ts'
import type { AdminContext } from './team-admin.ts'
import type { Access, TeamContext } from './team-api.ts'
import { ownerAccessToken, teamDrive } from './team-drive.ts'
import { notingRefs } from './team-refs.ts'

/** What a test replaces; the real ones are the defaults */
export interface TeamDeps {
  providers?: IdentityProvider[]
  google?: Pick<GoogleApi, 'refreshAccessToken'>
  /** The `fetch` that reaches Drive */
  fetch?: typeof fetch
  now?: () => number
}

/** What a request uses to know who is asking and to reach Google: the real ones unless a test gives its own */
function resolve(env: Env, deps: TeamDeps) {
  return {
    providers: deps.providers ?? [googleProvider(env)],
    google: deps.google ?? realGoogle,
    now: deps.now ?? Date.now,
  }
}

/** A space's Durable Object, by the space's id */
const roomsOf = (teamSpaces: NonNullable<Env['TEAM_SPACE']>) => (spaceId: string) =>
  teamSpaces.get(teamSpaces.idFromName(spaceId))

export function createTeamContext(
  env: Env,
  teamSpaces: NonNullable<Env['TEAM_SPACE']>,
  deps: TeamDeps = {}
): TeamContext {
  const { providers, google, now } = resolve(env, deps)
  const room = roomsOf(teamSpaces)

  // (a request's space is looked up once; its token source is shared by the calls it makes)
  const drives = new Map<string, ReturnType<typeof open>>()
  async function open(spaceId: string) {
    const info = await room(spaceId).info()
    if (!info) return null
    const token = ownerAccessToken({ room: room(spaceId), info, env, google, now })
    return { info, backend: teamDrive(token, deps.fetch) }
  }
  const drive = (spaceId: string) => {
    const found = drives.get(spaceId) ?? open(spaceId)
    drives.set(spaceId, found)
    return found
  }

  return {
    async access(request, spaceId): Promise<Access> {
      const identity = await authenticate(request, providers)
      if (!identity) return 'unauthenticated'
      return (await room(spaceId).roleOf(identity)) ?? 'not-a-member'
    },
    async space(spaceId) {
      const found = await drive(spaceId)
      return found && notingRefs(found.backend.space(found.info.rootRef), room(spaceId))
    },
    async root(spaceId) {
      const found = await drive(spaceId)
      const root = found && (await found.backend.inspectRoot(found.info.rootRef))
      return root && { ref: root.ref, name: root.name, trashed: root.trashed }
    },
    owns: (spaceId, ref) => room(spaceId).owns(ref),
    ownedAmong: (spaceId, refs) => room(spaceId).ownedAmong(refs),
  }
}

/** What making a space, joining one and looking after its people need */
export function createAdminContext(
  env: Env,
  teamSpaces: NonNullable<Env['TEAM_SPACE']>,
  deps: TeamDeps = {}
): AdminContext {
  const { providers, google, now } = resolve(env, deps)
  return {
    identify: request => authenticate(request, providers),
    room: roomsOf(teamSpaces),
    async inspectRoot(blob, owner, rootRef) {
      // (the blob is not stored yet: it is what the space would be made from)
      const info = { rootRef, name: '', owner, createdAt: '' }
      const token = ownerAccessToken({
        room: { ownerBlob: async () => blob },
        info,
        env,
        google,
        now,
      })
      const root = await teamDrive(token, deps.fetch).inspectRoot(rootRef)
      return root && { trashed: root.trashed, canWrite: root.canWrite }
    },
    openBlob: blob => decryptBlob(blob, env),
    newSpaceId: () => crypto.randomUUID(),
  }
}

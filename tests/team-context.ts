/**
 * A team space's server side on the in-memory storage, for the tests of the team API
 * (worker/src/team-api.ts) and of `TeamStorage`: two spaces on one backend, and a role for each
 * token, so a test chooses who is asking.
 */
import type { TeamRole } from '../src/js/team-roles.ts'
import {
  handleTeamRequest,
  refusal,
  type TeamContext,
  teamSpacePath,
} from '../worker/src/team-api.ts'
import { MemoryStorage } from './memory-storage.ts'

export const ORIGIN = 'https://chordless.test'

export interface TeamRig {
  storage: MemoryStorage
  /** The ids of the two spaces, and their roots in the storage */
  spaces: { id: string; root: string }[]
  /** The role each token has in every space; a token not here is not signed in */
  roles: Map<string, TeamRole | 'none'>
  context: TeamContext
  /** What the Worker answers: the `fetch` of a TeamStorage */
  fetch: typeof fetch
}

export async function makeTeamRig(): Promise<TeamRig> {
  const storage = new MemoryStorage()
  const spaces = [] as TeamRig['spaces']
  for (const id of ['space-1', 'space-2']) {
    spaces.push({ id, root: (await storage.ensureRoot(`Team ${id}`, id)).ref })
  }
  const roles = new Map<string, TeamRole | 'none'>([['writer-token', 'writer']])
  const rootOf = (id: string) => spaces.find(space => space.id === id)?.root

  const context: TeamContext = {
    async space(id) {
      const root = rootOf(id)
      return root ? storage.space(root) : null
    },
    async root(id) {
      const root = rootOf(id)
      const info = root ? await storage.inspectRoot(root) : null
      return info && { ref: info.ref, name: info.name, trashed: info.trashed }
    },
    async owns(id, ref) {
      // (a file in the bin is still the space's: its status says so)
      const root = rootOf(id)
      return storage.everything(f => f.root === root && f.ref === ref).length > 0
    },
    async ownedAmong(id, refs) {
      const root = rootOf(id)
      const here = new Set(storage.everything(f => f.root === root).map(f => f.ref))
      return refs.filter(ref => here.has(ref))
    },
  }

  const fetchTeam = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const path = teamSpacePath(new URL(request.url).pathname)
    if (!path) return new Response('Not found', { status: 404 })
    // (who is asking is settled first, as team-routes.ts does it: here, by the token alone)
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const role = roles.get(token)
    if (role === undefined) return refusal('unauthenticated')
    if (role === 'none') return refusal('not-a-member')
    return handleTeamRequest(request, path, context, role)
  }) as typeof fetch

  return { storage, spaces, roles, context, fetch: fetchTeam }
}

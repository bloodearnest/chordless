/**
 * Making a team space, joining one, and looking after its people (docs/SPACES.md, "Setting up and
 * joining a team space"). The storage API (team-api.ts) is for files; this is for the space itself.
 *
 *   POST   /api/spaces                  {blob, rootRef, name, ccliLicence?}  make a space from a folder you own
 *   POST   /api/spaces/join             {spaceId, code}         join with an invite
 *   GET    /api/space/<id>/invites                              admin: the open invites
 *   POST   /api/space/<id>/invites      {role, email}           admin: a new one, with its code
 *   DELETE /api/space/<id>/invites/<id>                         admin: revoke
 *   PUT    /api/space/<id>/members/<email> {role}               admin: change a role
 *   DELETE /api/space/<id>/members/<email>                      admin: remove
 *   POST   /api/space/<id>/leave                                a member: leave
 *   GET    /api/space/<id>/credential                           admin: how the Worker reaches the folder
 *   PUT    /api/space/<id>/credential   {blob}                  owner: a new sign-in for Drive (and
 *                                                               back to it from team storage)
 *   POST   /api/space/<id>/credential/service-account           owner: check team storage, and use it
 *   GET    /api/space/<id>/licence                              a member: the CCLI licence number (an admin
 *                                                               also gets the log of its changes)
 *   PUT    /api/space/<id>/licence      {ccliLicence}           a writer sets it where there is none;
 *                                                               an admin changes or clears it
 *   DELETE /api/space/<id>                                      owner: end sharing
 *
 * A role may only act on those below it: an admin looks after writers and readers, the owner after
 * admins too. The owner is never a member to change or remove.
 */

import { cleanLicence, MAX_LICENCE_LENGTH } from '../../src/js/ccli-licence.ts'
import {
  asMemberRole,
  atLeast,
  type MemberRole,
  outranks,
  type TeamRole,
} from '../../src/js/team-roles.ts'
import type { BlobData } from './blob.ts'
import { answering, jsonResponse, Refusal, readJson } from './http.ts'
import type { Identity } from './identity.ts'
import { refusal } from './team-api.ts'
import type { RegisteredTeam, TeamRegister } from './team-register.ts'
import type { SpaceInfo, TeamSpaceApi } from './team-state.ts'

/** What these routes need from the Worker */
export interface AdminContext {
  /** Who is asking, from the ID token; null if no one */
  identify(request: Request): Promise<Identity | null>
  room(spaceId: string): TeamSpaceApi
  /** The folder as the owner's own Drive access sees it, before anything is stored */
  inspectRoot(
    blob: string,
    owner: Identity,
    rootRef: string
  ): Promise<{ trashed: boolean; canWrite: boolean | null } | null>
  /** The blob's contents; throws if it is not one of ours */
  openBlob(blob: string): Promise<BlobData>
  /** The service account's address (team-managed storage), or null where it is not set up */
  serviceAccount(): string | null
  /** Why the service account cannot keep the folder's files, or null if it can (service-account.ts) */
  checkServiceAccount(rootRef: string, address: string): Promise<string | null>
  /** A new id for a space */
  newSpaceId(): string
  /** The register of teams, or null where there is no database for it (team-register.ts) */
  register(): TeamRegister | null
}

function asRole(value: unknown): MemberRole {
  const role = asMemberRole(value)
  if (!role) throw new Refusal(400, 'Not a role')
  return role
}

/** A licence number as the body gave it: tidied, and refused where it is not text or is too long */
function licenceFrom(value: unknown): string {
  if (typeof value !== 'string')
    throw new Refusal(400, 'A licence number is text (empty to clear it)')
  const licence = cleanLicence(value)
  if (licence.length > MAX_LICENCE_LENGTH) throw new Refusal(400, 'That licence number is too long')
  return licence
}

/**
 * Note something in the register of teams. Best effort: the register is a record for CCLI and for
 * billing, not part of how a team works, so a database that is down must not stop a team being made
 * or looked after. A write that fails is lost but the next one for the team puts its row right.
 */
async function register(
  ctx: AdminContext,
  room: TeamSpaceApi,
  spaceId: string,
  write: (register: TeamRegister, team: RegisteredTeam) => Promise<unknown>
): Promise<void> {
  const target = ctx.register()
  if (!target) return
  try {
    // (the space is there: whoever is acting on it has a role in it)
    const info = (await room.info()) as SpaceInfo
    await write(target, {
      spaceId,
      name: info.name,
      ownerEmail: info.owner.email,
      createdAt: info.createdAt,
    })
  } catch (error) {
    console.error('Team register: a write failed', error)
  }
}

/** The team has as many people as its Durable Object lists now */
const noteMembers = (ctx: AdminContext, room: TeamSpaceApi, spaceId: string) =>
  register(ctx, room, spaceId, async (target, team) =>
    target.members(team, (await room.members()).length)
  )

/** Check that a blob is this person's, and that they can write to the folder with it */
async function checkSharing(ctx: AdminContext, identity: Identity, blob: string, rootRef: string) {
  let data: BlobData
  try {
    data = await ctx.openBlob(blob)
  } catch {
    throw new Refusal(400, 'That Google sign-in is not one this server made')
  }
  if (identity.provider !== 'google' || data.owner_sub !== identity.sub) {
    throw new Refusal(403, 'That Google sign-in is not yours')
  }
  const root = await ctx.inspectRoot(blob, identity, rootRef)
  if (!root || root.trashed || root.canWrite === false) {
    throw new Refusal(400, 'That folder is not there, or you cannot change it')
  }
}

/** POST /api/spaces: share a folder you own as a team space; the space's id is issued here */
export function handleCreateSpace(request: Request, ctx: AdminContext): Promise<Response> {
  return answering('Team space admin', async () => {
    const identity = await ctx.identify(request)
    if (!identity) return refusal('unauthenticated')
    const body = await readJson(request)
    const { blob, rootRef } = body
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (typeof blob !== 'string' || typeof rootRef !== 'string' || !rootRef) {
      throw new Refusal(400, 'A blob and a folder are needed')
    }
    if (!name || name.length > 200) throw new Refusal(400, 'A space needs a name')
    const ccliLicence = body.ccliLicence === undefined ? '' : licenceFrom(body.ccliLicence)
    await checkSharing(ctx, identity, blob, rootRef)

    const spaceId = ctx.newSpaceId()
    const room = ctx.room(spaceId)
    if (!(await room.create({ rootRef, name, owner: identity }))) {
      throw new Refusal(409, 'That space already exists')
    }
    await room.setOwnerBlob(blob)
    if (ccliLicence) await room.setLicence(ccliLicence, identity)
    await register(ctx, room, spaceId, (target, team) =>
      target.created(team, identity.email, ccliLicence || null, 1)
    )
    return jsonResponse({ spaceId, role: 'owner' })
  })
}

/** POST /api/spaces/join: use an invite. A code that is not good is just that, whatever the reason */
export function handleJoin(request: Request, ctx: AdminContext): Promise<Response> {
  return answering('Team space admin', async () => {
    const identity = await ctx.identify(request)
    if (!identity) return refusal('unauthenticated')
    const { spaceId, code } = await readJson(request)
    if (typeof spaceId !== 'string' || typeof code !== 'string' || !SPACE_ID.test(spaceId)) {
      return jsonResponse({ error: 'This invite is not valid' }, 404)
    }
    const role = await ctx.room(spaceId).redeemInvite(code, identity)
    if (role === 'other-account') {
      // (they hold the code, so telling them it is for someone else gives nothing away)
      return jsonResponse({ error: 'This invite was sent to a different Google account' }, 403)
    }
    if (!role) return jsonResponse({ error: 'This invite is not valid' }, 404)
    await noteMembers(ctx, ctx.room(spaceId), spaceId)
    return jsonResponse({ spaceId, role })
  })
}

/** An email address, as loosely as it takes to tell one from a mistake */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** What a space id looks like (they are made here, so anything else is not one) */
export const SPACE_ID = /^[A-Za-z0-9_-]{8,64}$/

/** What an admin route is given: the request, the space, who is asking, and the path's parts */
interface AdminCall {
  request: Request
  ctx: AdminContext
  room: TeamSpaceApi
  spaceId: string
  identity: Identity
  role: TeamRole
  /** What the route's path captured */
  params: string[]
  /** Refuse unless the person outranks this role: an admin may act on those below them; the owner on everyone */
  above(target: TeamRole): void
}

interface AdminRoute {
  methods: string[]
  /** The rest of the path, after /api/space/<id> */
  path: RegExp
  /** The least role it needs (any member, if none) */
  needs?: TeamRole
  run(call: AdminCall): Promise<Response>
}

const done = () => new Response(null, { status: 204 })

const ADMIN_ROUTES: AdminRoute[] = [
  {
    methods: ['GET'],
    path: /^\/invites$/,
    needs: 'admin',
    run: async ({ room }) => jsonResponse(await room.invites()),
  },
  {
    methods: ['POST'],
    path: /^\/invites$/,
    needs: 'admin',
    async run({ request, room, identity, above }) {
      const body = await readJson(request)
      const target = asRole(body.role)
      above(target)
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      if (!EMAIL.test(email) || email.length > 254) {
        throw new Refusal(400, 'An invite is for an email address')
      }
      return jsonResponse(await room.createInvite(target, email, identity))
    },
  },
  {
    methods: ['DELETE'],
    path: /^\/invites\/([0-9a-f]+)$/,
    needs: 'admin',
    run: async ({ room, params: [id] }) =>
      (await room.revokeInvite(id)) ? done() : jsonResponse({ error: 'No such invite' }, 404),
  },
  {
    methods: ['PUT', 'DELETE'],
    path: /^\/members\/([^/]+)$/,
    needs: 'admin',
    async run({ request, ctx, room, spaceId, params: [who], above }) {
      const email = decodeURIComponent(who).toLowerCase()
      const current = (await room.members()).find(each => each.email === email)
      if (!current) return jsonResponse({ error: 'No such member' }, 404)
      above(current.role)
      if (request.method === 'PUT') {
        const target = asRole((await readJson(request)).role)
        above(target)
        await room.setRoleByEmail(email, target)
      } else {
        await room.removeByEmail(email)
        await noteMembers(ctx, room, spaceId)
      }
      return done()
    },
  },
  {
    methods: ['POST'],
    path: /^\/leave$/,
    async run({ ctx, room, spaceId, identity, role }) {
      if (role === 'owner') throw new Refusal(400, 'The owner cannot leave: end sharing instead')
      await room.removeMember(identity)
      await noteMembers(ctx, room, spaceId)
      return done()
    },
  },
  {
    methods: ['GET'],
    path: /^\/credential$/,
    needs: 'admin',
    run: async ({ ctx, room }) =>
      jsonResponse({ kind: await room.credential(), serviceAccount: ctx.serviceAccount() }),
  },
  {
    methods: ['POST'],
    path: /^\/credential\/service-account$/,
    needs: 'owner',
    async run({ ctx, room }) {
      const serviceAccount = ctx.serviceAccount()
      if (!serviceAccount)
        throw new Refusal(503, 'Team-managed storage is not set up on this server')
      // (the space is there: the asker's role in it was found)
      const { rootRef } = (await room.info()) as SpaceInfo
      const problem = await ctx.checkServiceAccount(rootRef, serviceAccount)
      if (problem) throw new Refusal(409, problem)
      await room.useServiceAccount()
      return jsonResponse({ kind: 'service-account', serviceAccount })
    },
  },
  {
    methods: ['PUT'],
    path: /^\/credential$/,
    needs: 'owner',
    async run({ request, ctx, room, identity }) {
      const { blob } = await readJson(request)
      const info = await room.info()
      if (typeof blob !== 'string' || !info) throw new Refusal(400, 'A blob is needed')
      await checkSharing(ctx, identity, blob, info.rootRef)
      await room.setOwnerBlob(blob)
      return done()
    },
  },
  {
    methods: ['GET'],
    path: /^\/licence$/,
    async run({ room, role }) {
      const { ccliLicence, history } = await room.licence()
      return jsonResponse(atLeast(role, 'admin') ? { ccliLicence, history } : { ccliLicence })
    },
  },
  {
    methods: ['PUT'],
    path: /^\/licence$/,
    needs: 'writer',
    async run({ request, ctx, room, spaceId, identity, role }) {
      const next = licenceFrom((await readJson(request)).ccliLicence)
      const { ccliLicence: current } = await room.licence()
      if (current && current !== next && !atLeast(role, 'admin')) {
        throw new Refusal(403, 'Only an admin can change the licence number')
      }
      if (await room.setLicence(next || null, identity)) {
        await register(ctx, room, spaceId, (target, team) =>
          target.licence(team, identity.email, current, next || null)
        )
      }
      return jsonResponse({ ccliLicence: next || null })
    },
  },
  {
    methods: ['DELETE'],
    path: /^\/$/,
    needs: 'owner',
    async run({ ctx, room, spaceId, identity }) {
      // (noted first: once the space is destroyed there is no one to ask what it was called)
      await register(ctx, room, spaceId, (target, team) => target.ended(team, identity.email))
      await room.destroy()
      return done()
    },
  },
]

/** Whether the admin routes serve this path (the rest is the storage API's) */
export function isAdminRoute(rest: string): boolean {
  return ADMIN_ROUTES.some(route => route.path.test(rest))
}

/** The admin routes of one space, for someone whose role in it is `role` (checked by the caller) */
export function handleSpaceAdmin(
  request: Request,
  { spaceId, rest }: { spaceId: string; rest: string },
  ctx: AdminContext,
  { identity, role }: { identity: Identity; role: TeamRole }
): Promise<Response> {
  return answering('Team space admin', async () => {
    for (const route of ADMIN_ROUTES) {
      const match = route.path.exec(rest)
      if (!match || !route.methods.includes(request.method)) continue
      if (route.needs && !atLeast(role, route.needs)) {
        throw new Refusal(403, `This needs the ${route.needs} role`)
      }
      return route.run({
        request,
        ctx,
        room: ctx.room(spaceId),
        spaceId,
        identity,
        role,
        params: match.slice(1),
        above(target) {
          if (!outranks(role, target)) throw new Refusal(403, 'Only a higher role can do that')
        },
      })
    }
    return jsonResponse({ error: 'Not found' }, 404)
  })
}

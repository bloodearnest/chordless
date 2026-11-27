/**
 * A Drive team that has become one of a church's (docs/CENTRAL_STORAGE.md, step 8), on a device that has it. The server only
 * changes who the team belongs to; what the team holds is sent by its members' devices, each from what it has (every device of
 * a team syncs the same Drive files, so they hold the same songs and setlists under the same ids, and what is sent twice is one
 * thing). Before the device takes the church's data in place of its own, it queues each of its setlists to be created, so that
 * the first read cannot replace them (as a move of a Personal space does), and its songs go up with the church library's first
 * sync. A setlist's leader was a person of the team; the church's people are accounts, so a leader is linked to the member of
 * the same name, or kept as a name in words.
 */
import type { Person } from './data-types.ts'
import { normalizeName, resolvePerson } from './leaders.ts'
import type { SpaceSetlist } from './space-data-types.ts'

/** A member of the church, as `GET /api/churches/<id>/members` lists them */
export interface ChurchPerson {
  id: string
  name: string | null
  role: string
}

/** What a setlist's leader becomes */
export interface MappedLeader {
  leaderId: string | null
  leaderName: string | null
}

/**
 * Where a leader goes: the member they are (by the account the team knew them as, else by name), if that member may lead (a
 * worship leader or admin, as the server requires); else the name, as words; nobody if the setlist had none or the person
 * is gone.
 */
export function leaderMapper(people: Person[], members: ChurchPerson[]) {
  const mayLead = members.filter(member => member.role === 'writer' || member.role === 'admin')
  const byName = new Map(
    mayLead.flatMap(member =>
      member.name ? [[normalizeName(member.name), member.id] as const] : []
    )
  )
  return (leaderId: string | null | undefined): MappedLeader => {
    const person = resolvePerson(people, leaderId)
    if (!person) return { leaderId: null, leaderName: null }
    const account = person.teamMember?.startsWith('chordless:')
      ? person.teamMember.slice('chordless:'.length)
      : ''
    if (account && mayLead.some(member => member.id === account))
      return { leaderId: account, leaderName: null }
    const matched = byName.get(normalizeName(person.name))
    if (matched) return { leaderId: matched, leaderName: null }
    const name = person.name.trim().slice(0, 200)
    return { leaderId: null, leaderName: name || null }
  }
}

/** A setlist as it is created in the church: its leader mapped, and nothing else changed */
export function adoptedRecord(
  record: SpaceSetlist,
  map: (leaderId: string | null | undefined) => MappedLeader
): SpaceSetlist {
  return { ...record, ...map(record.leaderId) }
}

/* v8 ignore start -- wiring to the device's database and the Worker: the rule above is what the tests hold */
/** Queue a team space's setlists to be created in its church, with their leaders mapped; the space's own sync sends them */
export async function seedTeamAdoption(spaceId: string, churchId: string): Promise<void> {
  const [{ openSpace }, { SpaceDataStore }, { churchClient }] = await Promise.all([
    import('./db.ts'),
    import('./space-data-store.ts'),
    import('./church-client.ts'),
  ])
  const db = await openSpace(spaceId, 'sync')
  const map = leaderMapper(await db.getAllPeople(), await churchClient.members(churchId))
  await new SpaceDataStore(db, {
    readKinds: ['setlist', 'person'],
    writeKinds: ['setlist'],
  }).seedPersonalMove(record => adoptedRecord(record, map))
}

/** Send what this device holds of an adopted team now (its songs, then its setlists), and say so, rather than at the next tick */
export async function sendAdopted(spaceId: string): Promise<void> {
  const [{ syncSpaceDataFor }, { getSpaceById }, { toast }, { t }] = await Promise.all([
    import('./space-data-runtime.ts'),
    import('./space.ts'),
    import('./toast.ts'),
    import('./text.ts'),
  ])
  const space = await getSpaceById(spaceId)
  if (space) toast(t('team-adopted', { name: space.name }))
  await syncSpaceDataFor(spaceId, { all: true })
}
/* v8 ignore stop */

import { expect } from '@open-wc/testing'
import type { Person } from '../src/js/data-types.ts'
import type { SpaceSetlist } from '../src/js/space-data-types.ts'
import { adoptedRecord, type ChurchPerson, leaderMapper } from '../src/js/team-adoption.ts'

const { describe, it } = window

const person = (id: string, name: string, extra: Partial<Person> = {}): Person => ({
  id,
  name,
  emails: [],
  modifiedDate: '2026-11-27T00:00:00.000Z',
  ...extra,
})
const member = (id: string, name: string | null, role: string): ChurchPerson => ({ id, name, role })

describe('a leader of a Drive team, in its church', () => {
  const people = [
    person('p-ann', 'Ann Smith', { teamMember: 'chordless:acct-ann' }),
    person('p-ben', '  ben JONES '),
    person('p-cat', 'Cat Reader'),
    person('p-gone', 'Dan Left'),
    person('p-merged', 'Ann (old)', { mergedInto: 'p-ann' }),
    person('p-deleted', 'Eve Deleted', { deleted: true }),
    person('p-blank', '   '),
  ]
  const members = [
    member('acct-ann', 'Ann Smith', 'admin'),
    member('acct-ben', 'Ben Jones', 'writer'),
    member('acct-cat', 'Cat Reader', 'reader'),
    member('acct-x', null, 'writer'),
  ]
  const map = leaderMapper(people, members)

  it('is the member the team knew them as, or the member of that name', () => {
    expect(map('p-ann')).to.deep.equal({ leaderId: 'acct-ann', leaderName: null })
    expect(map('p-ben')).to.deep.equal({ leaderId: 'acct-ben', leaderName: null })
    expect(map('p-merged')).to.deep.equal(
      { leaderId: 'acct-ann', leaderName: null },
      'a person merged into another is that one'
    )
  })

  it('is kept as a name when no member who may lead has it, and is nobody when there was none', () => {
    expect(map('p-cat')).to.deep.equal({ leaderId: null, leaderName: 'Cat Reader' }) // (a reader may not lead)
    expect(map('p-gone')).to.deep.equal({ leaderId: null, leaderName: 'Dan Left' })
    expect(map('p-blank')).to.deep.equal({ leaderId: null, leaderName: null })
    expect(map('p-deleted')).to.deep.equal({ leaderId: null, leaderName: null })
    expect(map('unknown')).to.deep.equal({ leaderId: null, leaderName: null })
    expect(map(null)).to.deep.equal({ leaderId: null, leaderName: null })
    expect(map(undefined)).to.deep.equal({ leaderId: null, leaderName: null })
  })

  it('does not link an account the church does not have, and cuts a long name to what a name may be', () => {
    const strays = leaderMapper(
      [
        person('p', 'Zed', { teamMember: 'chordless:acct-nobody' }),
        person('long', 'x'.repeat(300)),
      ],
      members
    )
    expect(strays('p')).to.deep.equal({ leaderId: null, leaderName: 'Zed' })
    expect(strays('long').leaderName).to.have.length(200)
  })

  it('changes the leader of a setlist and nothing else', () => {
    const record = {
      setlistId: 's',
      name: 'Sunday',
      leaderId: 'p-ann',
      songs: [],
      version: 3,
    } as unknown as SpaceSetlist
    expect(adoptedRecord(record, map)).to.deep.equal({
      ...record,
      leaderId: 'acct-ann',
      leaderName: null,
    })
    expect(adoptedRecord({ ...record, leaderId: 'p-gone' }, map)).to.include({
      leaderId: null,
      leaderName: 'Dan Left',
      name: 'Sunday',
    })
  })
})

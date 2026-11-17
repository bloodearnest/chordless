/** The rows of a Team's list of people (person-rows.ts): who is a member, who is invited, who only leads. */
import { expect } from '@open-wc/testing'
import type { Person } from '../src/js/data-types.ts'
import {
  daysLeft,
  filterRows,
  type PersonRow,
  personRows,
  sortRows,
} from '../src/js/person-rows.ts'
import type { InviteInfo, TeamMember } from '../src/js/team-roles.ts'

const { describe, it } = window

const person = (
  id: string,
  name: string,
  emails: string[],
  over: Partial<Person> = {}
): Person => ({
  id,
  name,
  emails,
  modifiedDate: '2026-11-17T00:00:00Z',
  ...over,
})
const invite = (id: string, email: string, role: 'admin' | 'writer' | 'reader'): InviteInfo => ({
  id,
  email,
  role,
  createdBy: 'bea@example.com',
  createdAt: '2026-11-16T00:00:00Z',
  expiresAt: '2026-11-23T00:00:00Z',
})

const members: TeamMember[] = [
  { email: 'bea@example.com', role: 'owner' },
  { email: 'tom@work.org', emails: ['tom@work.org', 'tom@home.org'], role: 'admin' },
  { email: 'ann@hotmail.com', role: 'writer' },
  { email: 'pat@x.org', role: 'reader' },
]
const people = [
  person('bea', 'Bea Singer', ['bea@example.com']),
  person('tom', 'Tom Smith', ['tom@home.org', 'tom@extra.org']),
  person('vic', 'Visiting Vic', []),
  person('gone', 'Gone', [], { deleted: true }),
  person('merged', 'Merged', [], { mergedInto: 'bea' }),
]
const rows = () =>
  personRows({
    people,
    members,
    invites: [invite('i1', 'sam@y.org', 'reader')],
    counts: new Map([
      ['tom', 3],
      ['vic', 1],
    ]),
    meId: 'bea',
  })
const names = (list: PersonRow[]) => list.map(row => row.name)

describe('personRows', () => {
  it('has a row for each member, invite and person who is no member, and none for a deleted or merged one', () => {
    const all = rows()
    expect(all.map(row => `${row.kind}:${row.name}`)).to.deep.equal([
      'member:Bea Singer',
      'member:Tom Smith',
      'member:ann@hotmail.com',
      'member:pat@x.org',
      'invite:sam@y.org',
      'visitor:Visiting Vic',
    ])
  })

  it('names a member from their person, found by any address, and by their address when they have none', () => {
    const [bea, tom, ann] = rows()
    expect(bea.person?.id).to.equal('bea')
    expect(tom.person?.id).to.equal('tom')
    expect(ann.person).to.equal(null)
    expect(ann.name).to.equal('ann@hotmail.com')
  })

  it('shows the first address and how many more there are, from the Worker and the person together', () => {
    const [, tom] = rows()
    expect(tom.email).to.equal('tom@work.org')
    expect(tom.emails).to.deep.equal(['tom@work.org', 'tom@home.org', 'tom@extra.org'])
    expect(tom.more).to.equal(2)
  })

  it('says how many setlists each leads, who is the one using the app, and what role each has', () => {
    const all = rows()
    expect(all.map(row => row.leads)).to.deep.equal([0, 3, 0, 0, 0, 1])
    expect(all.map(row => row.isMe)).to.deep.equal([true, false, false, false, false, false])
    expect(all.map(row => row.role)).to.deep.equal([
      'owner',
      'admin',
      'writer',
      'reader',
      'reader',
      null,
    ])
  })

  it('has no address for a person with none, and is empty with nothing', () => {
    const vic = rows().at(-1) as PersonRow
    expect(vic.email).to.equal('')
    expect(vic.more).to.equal(0)
    expect(
      personRows({ people: [], members: [], invites: [], counts: new Map(), meId: null })
    ).to.deep.equal([])
  })
})

describe('sortRows', () => {
  it('puts the highest role first by default, members before invites before others, then by name', () => {
    expect(names(sortRows(rows(), 'role'))).to.deep.equal([
      'Bea Singer',
      'Tom Smith',
      'ann@hotmail.com',
      'pat@x.org',
      'sam@y.org',
      'Visiting Vic',
    ])
  })

  it('sorts by name, and by status', () => {
    expect(names(sortRows(rows(), 'name'))).to.deep.equal([
      'ann@hotmail.com',
      'Bea Singer',
      'pat@x.org',
      'sam@y.org',
      'Tom Smith',
      'Visiting Vic',
    ])
    expect(sortRows(rows(), 'status').map(row => row.kind)).to.deep.equal([
      'member',
      'member',
      'member',
      'member',
      'invite',
      'visitor',
    ])
  })

  it('reverses, and leaves the rows it was given alone', () => {
    const given = rows()
    const before = names(given)
    expect(names(sortRows(given, 'name', true))[0]).to.equal('Visiting Vic')
    expect(names(given)).to.deep.equal(before)
  })

  it('puts an invite for a higher role above one for a lower, below every member', () => {
    const mixed = personRows({
      people: [],
      members,
      invites: [invite('a', 'low@x.org', 'reader'), invite('b', 'high@x.org', 'admin')],
      counts: new Map(),
      meId: null,
    })
    expect(names(sortRows(mixed, 'role')).slice(-2)).to.deep.equal(['high@x.org', 'low@x.org'])
  })
})

describe('filterRows', () => {
  it('keeps the rows with every typed word in the name or an address, ignoring case', () => {
    expect(names(filterRows(rows(), 'TOM'))).to.deep.equal(['Tom Smith'])
    expect(names(filterRows(rows(), 'tom extra'))).to.deep.equal(['Tom Smith'])
    expect(names(filterRows(rows(), 'hotmail'))).to.deep.equal(['ann@hotmail.com'])
    expect(filterRows(rows(), 'zzz')).to.deep.equal([])
  })

  it('keeps them all for nothing typed', () => {
    expect(filterRows(rows(), '   ')).to.have.length(6)
  })
})

describe('daysLeft', () => {
  it('counts whole days, rounding up, and stops at zero', () => {
    const now = new Date('2026-11-17T12:00:00Z')
    expect(daysLeft('2026-11-23T12:00:00Z', now)).to.equal(6)
    expect(daysLeft('2026-11-23T00:00:00Z', now)).to.equal(6)
    expect(daysLeft('2026-11-17T12:00:01Z', now)).to.equal(1)
    expect(daysLeft('2026-11-01T00:00:00Z', now)).to.equal(0)
  })
})

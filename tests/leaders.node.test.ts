import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Person, Setlist } from '../src/js/data-types.ts'
import {
  adoptLegacyLeader,
  findPerson,
  idFromKey,
  leaderName,
  normalizeName,
  planPeople,
  resolvePerson,
} from '../src/js/leaders.ts'

const NOW = '2026-10-29T10:00:00.000Z'
const person = (over: Partial<Person> & { id: string; name: string }): Person => ({
  emails: [],
  modifiedDate: NOW,
  ...over,
})

describe('normalizeName', () => {
  it('ignores case, accents, punctuation and spacing', () => {
    assert.equal(normalizeName('  Zoë  O’Brien-Smith. '), 'zoe o brien smith')
    assert.equal(normalizeName('Tom S.'), 'tom s')
  })
})

describe('idFromKey', () => {
  it('is the same uuid-shaped id for the same key, and another for another', () => {
    assert.equal(idFromKey('email:a@b.c'), idFromKey('email:a@b.c'))
    assert.notEqual(idFromKey('email:a@b.c'), idFromKey('email:a@b.d'))
    assert.match(idFromKey('x'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('findPerson', () => {
  const ann = person({ id: 'ann', name: 'Ann Smith', emails: ['ann@example.com', 'ann@work.org'] })
  const ben = person({ id: 'ben', name: 'Ben Jones' })
  const merged = person({
    id: 'old',
    name: 'Ann S',
    emails: ['old@example.com'],
    mergedInto: 'ann',
  })
  const people = [ann, ben, merged]

  it('finds by any of a person’s emails, ignoring case', () => {
    assert.equal(findPerson(people, { email: 'ANN@work.org' }), ann)
  })

  it('finds by name when the email is unknown or absent', () => {
    assert.equal(findPerson(people, { name: 'ben  jones' }), ben)
    assert.equal(findPerson(people, { name: 'Ann Smith', email: 'new@example.com' }), ann)
  })

  it('does not find a person who was merged into another', () => {
    assert.equal(findPerson(people, { email: 'old@example.com' }), undefined)
    assert.equal(findPerson(people, { name: 'Ann S' }), undefined)
  })

  it('finds nobody for nothing', () => {
    assert.equal(findPerson(people, {}), undefined)
  })
})

describe('resolvePerson and leaderName', () => {
  const a = person({ id: 'a', name: 'A', mergedInto: 'b' })
  const b = person({ id: 'b', name: 'B', mergedInto: 'c' })
  const c = person({ id: 'c', name: 'C' })

  it('follows merges to the person now', () => {
    assert.equal(resolvePerson([a, b, c], 'a'), c)
    assert.equal(leaderName([a, b, c], 'a'), 'C')
  })

  it('has nobody for an id it does not know, or none', () => {
    assert.equal(resolvePerson([c], 'zzz'), undefined)
    assert.equal(leaderName([c], undefined), '')
  })

  it('stops at a merge into a person who is not there, and at a loop', () => {
    const lost = person({ id: 'lost', name: 'Lost', mergedInto: 'gone' })
    assert.equal(resolvePerson([lost], 'lost'), lost)
    const x = person({ id: 'x', name: 'X', mergedInto: 'y' })
    const y = person({ id: 'y', name: 'Y', mergedInto: 'x' })
    assert.ok(resolvePerson([x, y], 'x'))
  })
})

describe('planPeople', () => {
  it('makes one person for each email, named by the spelling used most', () => {
    const { people, leaderIds } = planPeople(
      [
        { owner: 'Tom', ownerId: 'Tom@Example.com' },
        { owner: 'Tom Smith', ownerId: 'tom@example.com' },
        { owner: 'Tom Smith', ownerId: 'tom@example.com' },
        { owner: 'Ann', ownerId: 'ann@example.com' },
      ],
      NOW
    )
    assert.deepEqual(people.map(p => [p.name, p.emails]).sort(), [
      ['Ann', ['ann@example.com']],
      ['Tom Smith', ['tom@example.com']],
    ])
    assert.equal(leaderIds[0], leaderIds[1])
    assert.equal(leaderIds[1], leaderIds[2])
    assert.notEqual(leaderIds[2], leaderIds[3])
  })

  it('gives a name with no email to the one person with an email who is called that', () => {
    const { people, leaderIds } = planPeople(
      [{ owner: 'Ann Smith', ownerId: 'ann@example.com' }, { owner: 'ann  smith.' }],
      NOW
    )
    assert.equal(people.length, 1)
    assert.equal(leaderIds[0], leaderIds[1])
  })

  it('makes a person of their own for a name nobody with an email is called', () => {
    const { people, leaderIds } = planPeople(
      [
        { owner: 'Visiting Vic' },
        { owner: 'visiting vic' },
        { owner: 'Ann', ownerId: 'a@example.com' },
      ],
      NOW
    )
    assert.equal(people.length, 2)
    assert.equal(leaderIds[0], leaderIds[1])
    assert.equal(people.find(p => p.id === leaderIds[0])?.emails.length, 0)
  })

  it('does not join a name to two people with that name: they stay apart', () => {
    const { people, leaderIds } = planPeople(
      [
        { owner: 'Sam', ownerId: 'sam1@example.com' },
        { owner: 'Sam', ownerId: 'sam2@example.com' },
        { owner: 'Sam' },
      ],
      NOW
    )
    assert.equal(people.length, 3)
    assert.notEqual(leaderIds[2], leaderIds[0])
    assert.notEqual(leaderIds[2], leaderIds[1])
  })

  it('has no leader for no name and no email', () => {
    const { people, leaderIds } = planPeople([{ owner: '' }, {}, { owner: '  ' }], NOW)
    assert.deepEqual(people, [])
    assert.deepEqual(leaderIds, [null, null, null])
  })

  it('makes the same people, with the same ids, whatever order the setlists come in', () => {
    const leaders = [
      { owner: 'Ann', ownerId: 'a@example.com' },
      { owner: 'Vic' },
      { owner: 'Ben', ownerId: 'b@example.com' },
    ]
    const forward = planPeople(leaders, NOW)
    const backward = planPeople([...leaders].reverse(), NOW)
    assert.deepEqual(forward.people.map(p => p.id).sort(), backward.people.map(p => p.id).sort())
  })
})

describe('adoptLegacyLeader', () => {
  const setlist = (over: object) => ({ id: 's', songs: [], ...over }) as unknown as Setlist

  it('leaves a setlist that has no owner fields as it is', () => {
    const current = setlist({ leaderId: 'x' })
    assert.equal(adoptLegacyLeader(current, { known: [], added: [] }), current)
  })

  it('gives the person that is known, and drops the old fields', () => {
    const ann = person({ id: 'ann', name: 'Ann', emails: ['ann@example.com'] })
    const leaders = { known: [ann], added: [] as Person[] }
    const adopted = adoptLegacyLeader(
      setlist({ owner: 'Ann S.', ownerId: 'ANN@example.com' }),
      leaders
    )
    assert.equal(adopted.leaderId, 'ann')
    assert.equal('owner' in adopted, false)
    assert.equal('ownerId' in adopted, false)
    assert.deepEqual(leaders.added, [])
  })

  it('makes the person if there is none, once for two setlists of the same leader', () => {
    const leaders = { known: [] as Person[], added: [] as Person[] }
    const one = adoptLegacyLeader(setlist({ owner: 'Vic' }), leaders)
    const two = adoptLegacyLeader(setlist({ owner: 'vic' }), leaders)
    assert.equal(leaders.added.length, 1)
    assert.equal(one.leaderId, two.leaderId)
  })

  it('has no leader for an empty owner', () => {
    const adopted = adoptLegacyLeader(setlist({ owner: '', ownerId: '' }), {
      known: [],
      added: [],
    })
    assert.equal(adopted.leaderId, undefined)
    assert.equal('owner' in adopted, false)
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Person, Setlist } from '../src/js/data-types.ts'
import {
  adoptLegacyLeader,
  emailProblem,
  findPerson,
  idFromKey,
  leaderCounts,
  leaderName,
  mergePlan,
  normalizeName,
  planPeople,
  renamed,
  resolveLeader,
  resolvePerson,
  suggestPeople,
  withEmail,
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

describe('a leader known only by email', () => {
  it('is named by the email, in the plan and for a setlist from before people', () => {
    const { people, leaderIds } = planPeople(
      [{ ownerId: 'Cat@Example.com' }, { owner: ' ', ownerId: 'cat@example.com' }],
      NOW
    )
    assert.equal(people.length, 1)
    assert.equal(people[0].name, 'cat@example.com')
    assert.equal(leaderIds[0], leaderIds[1])
    const leaders = { known: [] as Person[], added: [] as Person[] }
    adoptLegacyLeader(
      { id: 's', ownerId: 'dan@example.com', songs: [] } as unknown as Setlist,
      leaders
    )
    assert.equal(leaders.added[0].name, 'dan@example.com')
  })
})

describe('suggestPeople', () => {
  const tom = person({ id: 'tom', name: 'Tom Smith' })
  const tim = person({ id: 'tim', name: 'Tim Smithers' })
  const ann = person({ id: 'ann', name: 'Ann Lee' })
  const gone = person({ id: 'gone', name: 'Tom Smith', mergedInto: 'tom' })
  const people = [ann, tim, tom, gone]

  it('suggests the person whose name a typed one abbreviates', () => {
    assert.deepEqual(suggestPeople(people, 'Tom S.'), [tom])
    // (Tim Smithers fits too, but less well)
    assert.deepEqual(suggestPeople(people, 'T Smith'), [tom, tim])
  })

  it('suggests a person for a first name or surname alone, and in any order', () => {
    assert.deepEqual(suggestPeople(people, 'Tom'), [tom])
    assert.deepEqual(suggestPeople(people, 'Smith, Tom'), [tom])
  })

  it('prefers whole words to abbreviations, and lists every candidate', () => {
    assert.deepEqual(suggestPeople(people, 'Smith'), [tom, tim])
    assert.deepEqual(suggestPeople(people, 'T'), [tim, tom])
  })

  it('suggests nobody for an exact name (that is a match), an unknown one, or none', () => {
    assert.deepEqual(suggestPeople(people, 'Tom Smith'), [])
    assert.deepEqual(suggestPeople(people, 'Zed'), [])
    assert.deepEqual(suggestPeople(people, ''), [])
    assert.deepEqual(suggestPeople(people, null), [])
  })

  it('uses each word of the name once', () => {
    assert.deepEqual(suggestPeople(people, 'Smith Smith'), [])
  })
})

describe('resolveLeader', () => {
  const tom = person({ id: 'tom', name: 'Tom Smith', emails: ['tom@example.com'] })
  const ann = person({ id: 'ann', name: 'Ann Lee' })

  it('is the person with the email, whatever the name', () => {
    assert.deepEqual(resolveLeader([ann, tom], { name: 'Thomas', email: 'TOM@example.com' }), {
      kind: 'match',
      person: tom,
      by: 'email',
    })
  })

  it('is the person of that name when the email is not any person’s', () => {
    assert.deepEqual(resolveLeader([ann, tom], { name: 'ann lee', email: 'new@example.com' }), {
      kind: 'match',
      person: ann,
      by: 'name',
    })
  })

  it('suggests people to ask about, or knows nobody', () => {
    assert.deepEqual(resolveLeader([ann, tom], { name: 'Tom S.', email: 'x@y.org' }), {
      kind: 'suggest',
      candidates: [tom],
    })
    assert.deepEqual(resolveLeader([ann, tom], { name: 'Zed', email: '' }), { kind: 'none' })
    assert.deepEqual(resolveLeader([], {}), { kind: 'none' })
  })
})

describe('changing a person', () => {
  const ann = person({ id: 'ann', name: 'Ann', emails: ['ann@example.com'] })
  const ben = person({ id: 'ben', name: 'Ben', emails: ['ben@example.com'] })

  it('is renamed with the name trimmed, and not for an empty or the same name', () => {
    assert.equal(renamed(ann, '  Anne  ', 'now').name, 'Anne')
    assert.equal(renamed(ann, '  Anne  ', 'now').modifiedDate, 'now')
    assert.equal(renamed(ann, '   '), ann)
    assert.equal(renamed(ann, 'Ann'), ann)
  })

  it('gains and loses addresses, lower-cased, and is unchanged when there is nothing to do', () => {
    assert.deepEqual(withEmail(ann, 'ANN@work.org', true, 'now').emails, [
      'ann@example.com',
      'ann@work.org',
    ])
    assert.deepEqual(withEmail(ann, 'Ann@Example.com', false, 'now').emails, [])
    assert.equal(withEmail(ann, 'ann@example.com', true), ann)
    assert.equal(withEmail(ann, 'x@y.org', false), ann)
  })

  it('says why an address cannot be added', () => {
    const people = [
      ann,
      ben,
      { ...person({ id: 'old', name: 'Old', emails: ['old@x.org'] }), mergedInto: 'ann' },
    ]
    assert.match(emailProblem(people, ann, 'nonsense') ?? '', /does not look like/)
    assert.match(emailProblem(people, ann, ' ANN@example.com ') ?? '', /already/)
    assert.match(emailProblem(people, ann, 'ben@example.com') ?? '', /Ben has that address/)
    assert.equal(emailProblem(people, ann, 'old@x.org'), null)
    assert.equal(emailProblem(people, ann, 'new@x.org'), null)
  })
})

describe('mergePlan', () => {
  const ann = person({ id: 'ann', name: 'Ann', emails: ['ann@example.com'] })
  const ben = person({
    id: 'ben',
    name: 'Ben',
    emails: ['ben@example.com'],
    teamMember: 'google:1',
  })
  const old = person({ id: 'old', name: 'Old Ben', mergedInto: 'ben' })

  it('joins the addresses, keeps a team link, marks the merged and repoints the earlier merges', () => {
    const plan = mergePlan([ann, ben, old], 'ben', 'ann', 'now') as Person[]
    const byId = Object.fromEntries(plan.map(p => [p.id, p]))
    assert.deepEqual(byId.ann.emails, ['ann@example.com', 'ben@example.com'])
    assert.equal(byId.ann.teamMember, 'google:1')
    assert.equal(byId.ben.mergedInto, 'ann')
    assert.equal(byId.old.mergedInto, 'ann')
    assert.equal(plan.length, 3)
  })

  it('keeps the team link the other person has', () => {
    const linked = { ...ann, teamMember: 'google:2' }
    const plan = mergePlan([linked, ben], 'ben', 'ann') as Person[]
    assert.equal(plan.find(p => p.id === 'ann')?.teamMember, 'google:2')
  })

  it('is nothing for the same person, or one that is not there or already merged', () => {
    assert.equal(mergePlan([ann, ben], 'ann', 'ann'), null)
    assert.equal(mergePlan([ann, ben], 'ann', 'zed'), null)
    assert.equal(mergePlan([ann, ben, old], 'old', 'ann'), null)
  })
})

describe('leaderCounts and deleted people', () => {
  const ann = person({ id: 'ann', name: 'Ann' })
  const old = person({ id: 'old', name: 'Old', mergedInto: 'ann' })
  const gone = person({ id: 'gone', name: 'Gone', deleted: true })

  it('counts the setlists each leads, a merged person’s for the one they became', () => {
    const counts = leaderCounts(
      [ann, old, gone],
      [{ leaderId: 'ann' }, { leaderId: 'old' }, { leaderId: 'gone' }, { leaderId: null }, {}]
    )
    assert.deepEqual([...counts], [['ann', 2]])
  })

  it('does not find, suggest or name a deleted person', () => {
    assert.equal(findPerson([gone], { name: 'Gone' }), undefined)
    assert.deepEqual(suggestPeople([{ ...gone, name: 'Gone Fishing' }], 'Gone'), [])
    assert.equal(leaderName([gone], 'gone'), '')
    assert.equal(
      resolveLeader([{ ...gone, emails: ['g@x.org'] }], { email: 'g@x.org' }).kind,
      'none'
    )
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

  it('drops the old fields of a setlist that has a leader already', () => {
    const adopted = adoptLegacyLeader(setlist({ owner: 'Vic', leaderId: 'v' }), {
      known: [],
      added: [],
    })
    assert.equal(adopted.leaderId, 'v')
    assert.equal('owner' in adopted, false)
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

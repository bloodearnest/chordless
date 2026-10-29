import { expect } from '@open-wc/testing'
import type { Person } from '../src/js/data-types.ts'
import { ChordlessDB } from '../src/js/db.ts'
import { getSignedInUser, getSpacePeople, personFor, settleLeader } from '../src/js/people.ts'
import { createSpace, deleteSpace, getCurrentSpace, setCurrentSpace } from '../src/js/space.ts'
import { SpaceDB } from '../src/js/space-db.ts'
import { installFakeAuthWorker } from './fake-auth-worker.ts'
import { must } from './must.ts'

const { describe, it, beforeEach, afterEach } = window

const NOW = '2026-10-29T10:00:00.000Z'
const person = (over: Partial<Person> & { id: string; name: string }): Person => ({
  emails: [],
  modifiedDate: NOW,
  ...over,
})

describe('personFor', () => {
  const ann = person({ id: 'ann', name: 'Ann Smith', emails: ['ann@example.com'] })
  const vic = person({ id: 'vic', name: 'Visiting Vic' })

  it('is nobody for no name and no email', () => {
    expect(personFor([ann], { name: ' ', email: '' })).to.equal(null)
  })

  it('finds the person by email, or by name, and changes nothing', () => {
    expect(personFor([ann], { email: 'ANN@example.com' })).to.deep.equal({
      person: ann,
      changed: [],
    })
    expect(personFor([ann], { name: 'ann smith' })?.person).to.equal(ann)
  })

  it('gives a person known only by name the email they are now found by', () => {
    const made = personFor([vic], { name: 'Visiting Vic', email: 'Vic@Example.com' }, NOW)
    expect(made?.person).to.deep.equal({ ...vic, emails: ['vic@example.com'] })
    expect(made?.changed).to.deep.equal([made?.person])
  })

  it('does not take another email for a person who has one: that is someone else', () => {
    const made = personFor([ann], { name: 'Ann Smith', email: 'ann@elsewhere.org' })
    expect(made?.person).to.equal(ann)
    expect(made?.changed).to.deep.equal([])
  })

  it('makes a person, with the id the same leader always gets', () => {
    const one = personFor([], { name: 'New Nat', email: 'nat@example.com' }, NOW)
    const two = personFor([], { name: 'Nat', email: 'NAT@example.com' }, NOW)
    expect(one?.person.name).to.equal('New Nat')
    expect(one?.person.emails).to.deep.equal(['nat@example.com'])
    expect(one?.changed).to.deep.equal([one?.person])
    expect(two?.person.id).to.equal(one?.person.id)
    expect(personFor([], { email: 'nat@example.com' })?.person.name).to.equal('nat@example.com')
  })
})

describe('the signed-in user and the space’s people', () => {
  let auth: ReturnType<typeof installFakeAuthWorker>
  let before: { id: string | null; name: string }
  let spaceId: string
  let db: ChordlessDB

  beforeEach(async () => {
    auth = installFakeAuthWorker()
    before = getCurrentSpace()
    const space = await createSpace(`People ${crypto.randomUUID().slice(0, 8)}`)
    spaceId = space.id
    await setCurrentSpace(space.id, space.name)
    db = new ChordlessDB(spaceId)
    await db.init()
  })

  afterEach(async () => {
    auth.uninstall()
    db.db?.close()
    await deleteSpace(spaceId)
    if (before.id) await setCurrentSpace(before.id, before.name)
  })

  const signIn = (user: { name: string | null; email: string | null }) => {
    auth.worker.stored = {
      blob: 'blob',
      metadata: {
        access_token: 'token',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        user: { picture: null, given_name: null, family_name: null, sub: '1', ...user },
      },
      updated_at: new Date().toISOString(),
    }
  }

  const withMembers = async (members: { email: string; name?: string }[]) => {
    const spaces = new SpaceDB()
    await spaces.init()
    await spaces.updateSpace(spaceId, { members })
    spaces.db?.close()
  }

  it('is nobody when not signed in, or signed in with no address', async () => {
    expect(await getSignedInUser()).to.equal(null)
    signIn({ name: 'Ann', email: null })
    expect(await getSignedInUser()).to.equal(null)
  })

  it('is the signed-in user by address, and by name if there is one', async () => {
    signIn({ name: 'Ann Singer', email: 'Ann@Example.com' })
    expect(await getSignedInUser()).to.deep.equal({ email: 'ann@example.com', name: 'Ann Singer' })
    signIn({ name: null, email: 'ann@example.com' })
    expect(await getSignedInUser()).to.deep.equal({
      email: 'ann@example.com',
      name: 'ann@example.com',
    })
  })

  it('has a person for each member of the space and for the signed-in user, stored, by name', async () => {
    await withMembers([{ email: 'ben@example.com', name: 'Ben' }, { email: 'cat@example.com' }])
    signIn({ name: 'Ann Singer', email: 'ann@example.com' })

    const { people, me } = await getSpacePeople(db)

    expect(me?.name).to.equal('Ann Singer')
    expect(me?.emails).to.deep.equal(['ann@example.com'])
    expect(people.map(each => each.name)).to.deep.equal(['Ann Singer', 'Ben', 'cat@example.com'])
    expect((await db.getAllPeople()).map(each => each.name).sort()).to.deep.equal([
      'Ann Singer',
      'Ben',
      'cat@example.com',
    ])
  })

  it('does not make them twice, or change the name someone has been given', async () => {
    await withMembers([{ email: 'ben@example.com', name: 'Ben' }])
    signIn({ name: 'Ann Singer', email: 'ann@example.com' })
    const first = await getSpacePeople(db)
    const ben = must(first.people.find(each => each.name === 'Ben'))
    await db.savePeople([{ ...ben, name: 'Benjamin' }])

    const again = await getSpacePeople(db)

    expect(again.people.map(each => each.name)).to.deep.equal(['Ann Singer', 'Benjamin'])
    expect(await db.getAllPeople()).to.have.length(2)
  })

  it('gives the signed-in user the person already led by their name', async () => {
    const [vic] = [person({ id: 'vic', name: 'Ann Singer' })]
    await db.savePeople([vic])
    signIn({ name: 'Ann Singer', email: 'ann@example.com' })

    const { me, people } = await getSpacePeople(db)

    expect(me?.id).to.equal('vic')
    expect(people).to.have.length(1)
    expect(me?.emails).to.deep.equal(['ann@example.com'])
  })

  it('leaves out people merged into others, and has just the members when nobody is signed in', async () => {
    await withMembers([{ email: 'ben@example.com', name: 'Ben' }])
    await db.savePeople([person({ id: 'gone', name: 'Old Ben', mergedInto: 'x' })])
    const { people, me } = await getSpacePeople(db)
    expect(me).to.equal(null)
    expect(people.map(each => each.name)).to.deep.equal(['Ben'])
  })

  it('has no person for a member with no address and no name', async () => {
    await withMembers([{ email: '' }, { email: 'ben@example.com', name: 'Ben' }])
    const { people } = await getSpacePeople(db)
    expect(people.map(each => each.name)).to.deep.equal(['Ben'])
  })

  it('has none, with no members and nobody signed in', async () => {
    const { people, me } = await getSpacePeople(db)
    expect(me).to.equal(null)
    expect(people).to.deep.equal([])
  })

  describe('settleLeader', () => {
    it('leaves the details as they are when no new leader was typed', async () => {
      expect(await settleLeader(db, { leaderId: 'p1', newLeader: '  ' })).to.deep.equal({
        leaderId: 'p1',
      })
      expect(await settleLeader(db, { leaderId: '' })).to.deep.equal({ leaderId: '' })
      expect(await db.getAllPeople()).to.deep.equal([])
    })

    it('makes and stores the person typed in, once however often it is typed', async () => {
      const one = await settleLeader(db, { leaderId: '', newLeader: 'Visiting Vic' })
      const two = await settleLeader(db, { leaderId: '', newLeader: 'visiting  vic' })
      expect(one.leaderId).to.be.ok
      expect(two.leaderId).to.equal(one.leaderId)
      expect(await db.getAllPeople()).to.have.length(1)
    })
  })
})

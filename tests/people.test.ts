import { expect } from '@open-wc/testing'
import type { Person } from '../src/js/data-types.ts'
import { ChordlessDB } from '../src/js/db.ts'
import { NEW_PERSON } from '../src/js/leaders.ts'
import {
  chosenMeId,
  getSignedInUser,
  getSpacePeople,
  identifyMe,
  newPerson,
  personFor,
  settleLeader,
} from '../src/js/people.ts'
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

describe('newPerson', () => {
  it('is named by the name, or by the address when it has none, and is nobody for neither', () => {
    expect(newPerson({ name: ' Nat ', email: 'NAT@example.com' }, NOW)).to.deep.equal({
      id: newPerson({ email: 'nat@example.com' })?.id,
      name: 'Nat',
      emails: ['nat@example.com'],
      modifiedDate: NOW,
    })
    expect(newPerson({ email: 'nat@example.com' })?.name).to.equal('nat@example.com')
    expect(newPerson({ name: 'Visiting Vic' })?.emails).to.deep.equal([])
    expect(newPerson({})).to.equal(null)
  })
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

  describe('which person is the one using the app', () => {
    const key = () => `chordless:me:${spaceId}`
    afterEach(() => localStorage.removeItem(key()))
    const ann = person({ id: 'ann', name: 'Ann Singer', emails: ['ann@work.org'] })

    it('is made for the signed-in account when nobody has its address or name', async () => {
      await db.savePeople([person({ id: 'ben', name: 'Ben', emails: ['ben@example.com'] })])
      signIn({ name: 'Cat Jones', email: 'cat@example.com' })

      const { me, askWho, people } = await getSpacePeople(db)

      expect(me?.name).to.equal('Cat Jones')
      expect(me?.emails).to.deep.equal(['cat@example.com'])
      expect(askWho).to.equal(false)
      expect(people).to.have.length(2)
    })

    it('is asked, and no other person made, when a person of that name has other addresses', async () => {
      await db.savePeople([ann])
      signIn({ name: 'Ann Singer', email: 'ann@home.org' })

      const { me, askWho, people } = await getSpacePeople(db)

      expect(me).to.equal(null)
      expect(askWho).to.equal(true)
      expect(people).to.have.length(1)
    })

    it('is the person chosen, who gains the address, and is found by it from then on', async () => {
      await db.savePeople([ann])
      signIn({ name: 'Ann Singer', email: 'ann@home.org' })

      await identifyMe(db, 'ann')

      expect(chosenMeId(spaceId)).to.equal('ann')
      expect((await must(await db.getPerson('ann'))).emails).to.deep.equal([
        'ann@work.org',
        'ann@home.org',
      ])
      const { me, askWho } = await getSpacePeople(db)
      expect(me?.id).to.equal('ann')
      expect(askWho).to.equal(false)
      localStorage.removeItem(key())
      expect((await getSpacePeople(db)).me?.id).to.equal('ann')
    })

    it('is the person chosen even when a later sign-in is with another address', async () => {
      await db.savePeople([ann])
      localStorage.setItem(key(), 'ann')
      signIn({ name: 'Somebody Else', email: 'else@example.com' })

      const { me } = await getSpacePeople(db)

      expect(me?.id).to.equal('ann')
      expect(must(await db.getPerson('ann')).emails).to.include('else@example.com')
    })

    it('is the person a chosen one was merged into', async () => {
      await db.savePeople([
        { ...ann, mergedInto: 'ann2' },
        person({ id: 'ann2', name: 'Ann S', emails: ['ann@home.org'] }),
      ])
      localStorage.setItem(key(), 'ann')
      signIn({ name: 'Ann S', email: 'ann@home.org' })

      expect((await getSpacePeople(db)).me?.id).to.equal('ann2')
    })

    it('is made from the account when none of the people is them', async () => {
      await db.savePeople([ann])
      signIn({ name: 'Ann Singer', email: 'ann@home.org' })

      await identifyMe(db, NEW_PERSON)

      const { me, people } = await getSpacePeople(db)
      expect(me?.emails).to.deep.equal(['ann@home.org'])
      expect(me?.id).to.not.equal('ann')
      expect(people).to.have.length(2)
    })

    it('is nobody to choose when nobody is signed in', async () => {
      await identifyMe(db, NEW_PERSON)
      expect(await db.getAllPeople()).to.deep.equal([])
      await identifyMe(db, 'nobody')
      expect(await db.getAllPeople()).to.deep.equal([])
    })

    it('is worked out from the account when the device cannot keep it', async () => {
      const getItem = Storage.prototype.getItem
      const setItem = Storage.prototype.setItem
      // (only the place that is kept: the rest of the app reads storage too)
      Storage.prototype.getItem = function (name: string) {
        if (name.startsWith('chordless:me:')) throw new Error('blocked')
        return getItem.call(this, name)
      }
      Storage.prototype.setItem = function (name: string, value: string) {
        if (name.startsWith('chordless:me:')) throw new Error('blocked')
        return setItem.call(this, name, value)
      }
      try {
        await db.savePeople([ann])
        signIn({ name: 'Ann Singer', email: 'ann@work.org' })
        await identifyMe(db, 'ann')
        expect(chosenMeId(spaceId)).to.equal(null)
        expect((await getSpacePeople(db)).me?.id).to.equal('ann')
      } finally {
        Storage.prototype.getItem = getItem
        Storage.prototype.setItem = setItem
      }
    })
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

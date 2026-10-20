import { expect } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import {
  claimSetlistsOnce,
  claimSetlistsWithoutOwnerId,
  getCurrentPerson,
  getSpacePeople,
  mergePeople,
} from '../src/js/people.ts'
import { createSpace, deleteSpace, getCurrentSpace, setCurrentSpace } from '../src/js/space.ts'
import { SpaceDB } from '../src/js/space-db.ts'
import { installFakeAuthWorker } from './fake-auth-worker.ts'

const { describe, it, beforeEach, afterEach } = window

describe('mergePeople', () => {
  it('keeps one entry per id, ignoring case, sorted by name', () => {
    expect(
      mergePeople([
        { id: 'ben@example.com', name: 'Ben' },
        { id: 'ann@example.com', name: 'Ann' },
        { id: 'BEN@example.com', name: 'Benjamin' },
        { id: '', name: 'No id' },
      ])
    ).to.deep.equal([
      { id: 'ann@example.com', name: 'Ann' },
      { id: 'ben@example.com', name: 'Ben' },
    ])
  })
})

describe('claimSetlistsWithoutOwnerId', () => {
  let db
  const me = { id: 'simon@example.com', name: 'Simon Davy' }

  beforeEach(async () => {
    db = new ChordlessDB(`test-people-${crypto.randomUUID()}`)
    await db.init()
  })

  afterEach(async () => {
    db.db.close()
    await new Promise(resolve => {
      const request = indexedDB.deleteDatabase(db.dbName)
      request.onsuccess = request.onerror = request.onblocked = resolve
    })
  })

  const save = (id, fields) =>
    db.saveSetlist({
      id,
      date: '2026-10-11',
      songs: [],
      modifiedDate: '2026-01-01T00:00:00Z',
      ...fields,
    })

  it('claims setlists led by my name or without a leader, and nothing else', async () => {
    await save('mine-by-name', { owner: 'simon davy' })
    await save('no-leader', { owner: '' })
    await save('someone-else', { owner: 'Ann Smith' })
    await save('already-has-id', { owner: 'Ann Smith', ownerId: 'ann@example.com' })

    const claimed = await claimSetlistsWithoutOwnerId(db, me)

    expect(claimed).to.equal(2)
    const get = async id => db.getSetlist(id)
    expect(await get('mine-by-name')).to.include({
      owner: 'Simon Davy',
      ownerId: 'simon@example.com',
    })
    expect(await get('no-leader')).to.include({ owner: 'Simon Davy', ownerId: 'simon@example.com' })
    expect((await get('mine-by-name')).modifiedDate).to.not.equal('2026-01-01T00:00:00Z')
    expect(await get('someone-else')).to.include({ owner: 'Ann Smith' })
    expect((await get('someone-else')).ownerId).to.equal(undefined)
    expect(await get('already-has-id')).to.include({ ownerId: 'ann@example.com' })
  })

  it('does nothing without a signed-in person', async () => {
    await save('no-leader', { owner: '' })
    expect(await claimSetlistsWithoutOwnerId(db, null)).to.equal(0)
  })
})

describe('the signed-in person and the space’s people', () => {
  let auth: ReturnType<typeof installFakeAuthWorker>
  let before: { id: string | null; name: string }
  let spaceId: string

  beforeEach(async () => {
    auth = installFakeAuthWorker()
    before = getCurrentSpace()
    const space = await createSpace(`People ${crypto.randomUUID().slice(0, 8)}`)
    spaceId = space.id
    await setCurrentSpace(space.id, space.name)
  })

  afterEach(async () => {
    auth.uninstall()
    localStorage.removeItem(`setlist-owner-ids-claimed:${spaceId}`)
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

  it('is nobody when not signed in, or signed in with no address', async () => {
    expect(await getCurrentPerson()).to.equal(null)
    signIn({ name: 'Ann', email: null })
    expect(await getCurrentPerson()).to.equal(null)
  })

  it('is the signed-in user by address, and by name if there is one', async () => {
    signIn({ name: 'Ann Singer', email: 'ann@example.com' })
    expect(await getCurrentPerson()).to.deep.equal({ id: 'ann@example.com', name: 'Ann Singer' })
    signIn({ name: null, email: 'ann@example.com' })
    expect(await getCurrentPerson()).to.deep.equal({
      id: 'ann@example.com',
      name: 'ann@example.com',
    })
  })

  it('lists the members of the space, and the signed-in user, by name', async () => {
    const spaces = new SpaceDB()
    await spaces.init()
    await spaces.updateSpace(spaceId, {
      members: [{ email: 'ben@example.com', name: 'Ben' }, { email: 'cat@example.com' }],
    })
    spaces.db?.close()
    signIn({ name: 'Ann Singer', email: 'ann@example.com' })

    const { people, me } = await getSpacePeople()

    expect(me).to.deep.equal({ id: 'ann@example.com', name: 'Ann Singer' })
    expect(people.map(person => person.name)).to.deep.equal([
      'Ann Singer',
      'Ben',
      'cat@example.com',
    ])
  })

  it('lists just the members when nobody is signed in, and none when it has none', async () => {
    const { people, me } = await getSpacePeople()
    expect(me).to.equal(null)
    expect(people).to.deep.equal([])
  })

  describe('claiming the setlists with no leader, once', () => {
    const key = () => `setlist-owner-ids-claimed:${spaceId}`
    const stubDb = (setlists: object[]) => {
      const saved: object[] = []
      return {
        saved,
        db: {
          getAllSetlists: async () => setlists,
          saveSetlist: async (setlist: object) => saved.push(setlist),
        } as unknown as ChordlessDB,
      }
    }

    it('waits, and tries again later, when nobody is signed in', async () => {
      const { db } = stubDb([{ id: 'x', owner: '' }])
      expect(await claimSetlistsOnce(db, spaceId)).to.equal(0)
      expect(localStorage.getItem(key())).to.equal(null)
    })

    it('claims them for the signed-in user, and does not do it again', async () => {
      signIn({ name: 'Ann Singer', email: 'ann@example.com' })
      const { db, saved } = stubDb([{ id: 'x', owner: '' }])

      expect(await claimSetlistsOnce(db, spaceId)).to.equal(1)
      expect(saved).to.have.length(1)
      expect(localStorage.getItem(key())).to.be.ok

      expect(await claimSetlistsOnce(db, spaceId)).to.equal(0)
      expect(saved).to.have.length(1)
    })

    it('gives up quietly, and tries again later, if the setlists cannot be read', async () => {
      signIn({ name: 'Ann Singer', email: 'ann@example.com' })
      const warn = console.warn
      console.warn = () => {}
      try {
        const db = {
          getAllSetlists: async () => {
            throw new Error('database closed')
          },
        } as unknown as ChordlessDB
        expect(await claimSetlistsOnce(db, spaceId)).to.equal(0)
      } finally {
        console.warn = warn
      }
      expect(localStorage.getItem(key())).to.equal(null)
    })
  })
})

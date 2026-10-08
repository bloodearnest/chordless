import { expect } from '@esm-bundle/chai'
import { ChordlessDB } from '../public/js/db.js'
import { claimSetlistsWithoutOwnerId, mergePeople } from '../public/js/people.js'

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

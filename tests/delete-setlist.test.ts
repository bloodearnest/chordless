import { expect } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import { makeLocalState, makeSetlist } from './builders.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

describe('ChordlessDB.deleteUnsyncedSetlist', () => {
  let db: ChordlessDB

  suppressConsoleLogs()

  beforeEach(async () => {
    db = new ChordlessDB(`test-delete-setlist-${crypto.randomUUID()}`)
    await db.init()
  })

  afterEach(() => db.db?.close())

  it('deletes a setlist that is not in Drive, with its state on this device', async () => {
    await db.saveSetlist(makeSetlist({ id: 'local-only' }))
    const unknownPads = (await db.getLocalState('never-existed')).padsEnabled
    await db.saveLocalState({ ...makeLocalState('local-only'), padsEnabled: !unknownPads })

    await db.deleteUnsyncedSetlist('local-only')

    expect(await db.getSetlist('local-only')).to.equal(undefined)
    // Back to the defaults of a setlist this device knows nothing about
    const unknown = await db.getLocalState('never-existed')
    expect((await db.getLocalState('local-only')).padsEnabled).to.equal(unknown.padsEnabled)
  })

  it('leaves other setlists alone', async () => {
    await db.saveSetlist(makeSetlist({ id: 'a' }))
    await db.saveSetlist(makeSetlist({ id: 'b' }))

    await db.deleteUnsyncedSetlist('a')

    expect((await db.getAllSetlists()).map(setlist => setlist.id)).to.deep.equal(['b'])
  })

  it('refuses a setlist that is in Drive, and changes nothing', async () => {
    await db.saveSetlist(makeSetlist({ id: 'in-drive', driveFileId: 'drive-file-1' }))

    let error: Error | null = null
    try {
      await db.deleteUnsyncedSetlist('in-drive')
    } catch (caught) {
      error = caught as Error
    }

    expect(error?.message).to.contain('in Google Drive')
    expect(await db.getSetlist('in-drive')).to.not.equal(undefined)
  })

  it('does nothing for a setlist that is not there', async () => {
    await db.deleteUnsyncedSetlist('nope')
  })
})

import { expect } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import { mayDeleteSetlist } from '../src/js/team-roles.ts'
import { must } from './must.ts'
import { makeLocalState, makeSetlist } from './builders.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

describe('ChordlessDB.removeSetlist', () => {
  let db: ChordlessDB

  suppressConsoleLogs()

  beforeEach(async () => {
    db = new ChordlessDB(`test-delete-setlist-${crypto.randomUUID()}`)
    await db.init()
  })

  afterEach(() => db.db?.close())

  it('deletes a setlist that is not in Drive, with its state on this device, and notes nothing', async () => {
    await db.saveSetlist(makeSetlist({ id: 'local-only' }))
    const unknownPads = (await db.getLocalState('never-existed')).padsEnabled
    await db.saveLocalState({ ...makeLocalState('local-only'), padsEnabled: !unknownPads })

    await db.removeSetlist('local-only')

    expect(await db.getSetlist('local-only')).to.equal(undefined)
    // Back to the defaults of a setlist this device knows nothing about
    const unknown = await db.getLocalState('never-existed')
    expect((await db.getLocalState('local-only')).padsEnabled).to.equal(unknown.padsEnabled)
    expect(await db.getPendingDeletions()).to.deep.equal([])
  })

  it('leaves other setlists alone', async () => {
    await db.saveSetlist(makeSetlist({ id: 'a' }))
    await db.saveSetlist(makeSetlist({ id: 'b' }))

    await db.removeSetlist('a')

    expect((await db.getAllSetlists()).map(setlist => setlist.id)).to.deep.equal(['b'])
  })

  it('notes the file of a setlist that is in Drive, for the next sync to put in the trash', async () => {
    await db.saveSetlist(makeSetlist({ id: 'in-drive', fileRef: 'drive-file-1' }))

    await db.removeSetlist('in-drive')

    expect(await db.getSetlist('in-drive')).to.equal(undefined)
    expect((await db.getPendingDeletions()).map(entry => [entry.ref, entry.kind])).to.deep.equal([
      ['drive-file-1', 'setlist'],
    ])
  })

  it('does nothing for a setlist that is not there', async () => {
    expect(await db.removeSetlist('nope')).to.equal(undefined)
    expect(await db.getPendingDeletions()).to.deep.equal([])
  })

  describe('restoreSetlist', () => {
    it('puts it back as it was, and calls off the trashing, while its file is not in the trash yet', async () => {
      await db.saveSetlist(makeSetlist({ id: 'in-drive', fileRef: 'drive-file-1', name: 'Kept' }))
      await db.saveLocalState({ ...makeLocalState('in-drive'), padsEnabled: true })
      const removed = must(await db.removeSetlist('in-drive'))

      await db.restoreSetlist(removed)

      const back = must(await db.getSetlist('in-drive'))
      expect(back.name).to.equal('Kept')
      expect(back.fileRef).to.equal('drive-file-1')
      expect((await db.getLocalState('in-drive')).padsEnabled).to.equal(true)
      expect(await db.getPendingDeletions()).to.deep.equal([])
    })

    it('makes it again without its link to the file when that is in the trash already', async () => {
      await db.saveSetlist(
        makeSetlist({
          id: 'in-drive',
          fileRef: 'drive-file-1',
          fileRev: 'rev-1',
          syncedContentHash: 'hash',
        })
      )
      const removed = must(await db.removeSetlist('in-drive'))
      // (a sync put the file in the trash)
      await db.clearPendingDeletion('drive-file-1')

      await db.restoreSetlist(removed)

      const back = must(await db.getSetlist('in-drive'))
      expect(back.fileRef).to.equal(undefined)
      expect(back.fileRev).to.equal(undefined)
      expect(back.syncedContentHash).to.equal(undefined)
    })
  })
})

describe('mayDeleteSetlist', () => {
  it('lets anyone in a personal space', () => {
    expect(mayDeleteSetlist(null, false)).to.equal(true)
  })

  it('lets an admin or the owner delete any setlist of a team', () => {
    expect(mayDeleteSetlist('admin', false)).to.equal(true)
    expect(mayDeleteSetlist('owner', false)).to.equal(true)
  })

  it('lets a worship leader delete only the setlists they lead', () => {
    expect(mayDeleteSetlist('writer', true)).to.equal(true)
    expect(mayDeleteSetlist('writer', false)).to.equal(false)
  })

  it('does not let a team member delete any', () => {
    expect(mayDeleteSetlist('reader', true)).to.equal(false)
  })
})

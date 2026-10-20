import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import { type SetlistDiffers, SetlistRevertedEvent } from '../src/components/setlist-differs.ts'
import { differsFromOfficial, revertSetlistToOfficial } from '../src/js/sync/revert.ts'
import { makeSetlist } from './builders.ts'
import { useSyncRig } from './drive-harness.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

describe('A setlist that differs from the official one', () => {
  const rig = useSyncRig()
  const { makeDevice, addSetlist, editSetlist, syncDevice } = rig

  it('is one a user who can only read has changed, and only that', () => {
    const synced = makeSetlist({ driveFileId: 'file-1', syncedContentHash: 'old' })
    expect(differsFromOfficial(synced, false)).to.equal(true)
    expect(differsFromOfficial(synced, true), 'a writer pushes it').to.equal(false)
    expect(differsFromOfficial({ ...synced, driveFileId: null }, false), 'not in Drive').to.equal(
      false
    )
  })

  it('is put back to what Drive holds, keeping its id and marking it synced', async () => {
    const leader = await makeDevice('leader')
    const setlist = await addSetlist(leader, { name: 'Sunday' })
    await syncDevice(leader)
    const member = await makeDevice('member')
    await syncDevice(member)
    await editSetlist(member, setlist.id, { name: 'My version' })
    const mine = must(await member.db.getSetlist(setlist.id))
    expect(differsFromOfficial(mine, false)).to.equal(true)

    const reverted = await revertSetlistToOfficial(member.db, mine, member.sync.space)
    expect(reverted.name).to.equal('Sunday')
    expect(reverted.id).to.equal(setlist.id)
    expect(must(await member.db.getSetlist(setlist.id)).name).to.equal('Sunday')
    expect(differsFromOfficial(reverted, false)).to.equal(false)
  })

  it('cannot be put back when the setlist is not in Drive, or its file is gone', async () => {
    const member = await makeDevice('member')
    const local = await addSetlist(member, { name: 'Only here' })
    let message = ''
    try {
      await revertSetlistToOfficial(member.db, local, member.sync.space)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).to.contain('not in Google Drive')

    message = ''
    try {
      await revertSetlistToOfficial(
        member.db,
        { ...local, driveFileId: 'no-such-file' },
        member.sync.space
      )
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).to.contain('gone from Drive')
  })

  describe('its dialog', () => {
    const revertButton = (el: SetlistDiffers) =>
      must(el.shadowRoot?.querySelector<HTMLButtonElement>('#revert-to-official'))

    it('puts the setlist back and says so, from its button', async () => {
      const leader = await makeDevice('leader')
      const setlist = await addSetlist(leader, { name: 'Sunday' })
      await syncDevice(leader)
      const member = await makeDevice('member')
      await syncDevice(member)
      await editSetlist(member, setlist.id, { name: 'My version' })

      const el = await fixture<SetlistDiffers>(
        html`<setlist-differs
          .setlist=${must(await member.db.getSetlist(setlist.id))}
          .db=${member.db}
          .storage=${member.sync.space}
        ></setlist-differs>`
      )
      el.show()
      let reverted = 0
      el.addEventListener(SetlistRevertedEvent.type, () => reverted++)
      revertButton(el).click()
      await waitUntil(() => reverted === 1, 'it says the setlist is back')
      expect(must(await member.db.getSetlist(setlist.id)).name).to.equal('Sunday')
    })

    it('says it could not, and changes nothing, when Drive cannot give the setlist', async () => {
      const member = await makeDevice('member')
      const local = await addSetlist(member, { name: 'Only here' })
      const el = await fixture<SetlistDiffers>(
        html`<setlist-differs .setlist=${local} .db=${member.db}></setlist-differs>`
      )
      let reverted = 0
      el.addEventListener(SetlistRevertedEvent.type, () => reverted++)
      revertButton(el).click()
      await waitUntil(() => !el._busy && !!document.querySelector('app-toast'), 'it is done')
      expect(reverted).to.equal(0)
      expect(must(await member.db.getSetlist(local.id)).name).to.equal('Only here')
    })

    it('shows nothing without a setlist, and does nothing', async () => {
      const el = await fixture<SetlistDiffers>(html`<setlist-differs></setlist-differs>`)
      expect(el.shadowRoot?.querySelector('app-modal')).to.equal(null)
      await el._revert()
    })
  })
})

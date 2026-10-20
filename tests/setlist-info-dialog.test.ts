import { expect, fixture, html } from '@open-wc/testing'
import {
  SetlistDetailsCancelEvent,
  SetlistDetailsSaveEvent,
} from '../src/components/setlist-details-form.ts'
import {
  SetlistInfoDeleteEvent,
  type SetlistInfoDialog,
  SetlistInfoSaveEvent,
} from '../src/components/setlist-info-dialog.ts'
import type { Setlist } from '../src/js/data-types.ts'
import { makeSetlist } from './builders.ts'
import { settle } from './test-helpers.ts'
import '../src/components/setlist-info-dialog.ts'

const { describe, it } = window

describe('setlist-info-dialog', () => {
  const show = () => fixture<SetlistInfoDialog>(html`<setlist-info-dialog></setlist-info-dialog>`)
  const modal = (el: SetlistInfoDialog) =>
    el.shadowRoot?.querySelector('app-modal') as HTMLElement & {
      open: boolean
      heading: string
    }
  const form = (el: SetlistInfoDialog) => el.shadowRoot?.querySelector('setlist-details-form')
  const editButton = (el: SetlistInfoDialog) =>
    el.shadowRoot?.querySelector<HTMLButtonElement>('.edit-button')
  const setlist = (over: Partial<Setlist> = {}) =>
    makeSetlist({ id: 'sl-1', date: '2026-10-25', name: 'Harvest', ...over })

  it('has a general heading before it has a setlist', async () => {
    const el = await show()
    expect(modal(el).heading).to.equal('Setlist info')
  })

  it('opens on a setlist, read-only, with its date as the heading', async () => {
    const el = await show()
    await el.show(setlist())
    await settle()
    expect(modal(el).open).to.equal(true)
    expect(modal(el).heading).to.contain('Harvest')
    expect(el.shadowRoot?.querySelector('setlist-info')).to.not.equal(null)
    expect(form(el)).to.equal(null)
    el.close()
    await settle()
    expect(modal(el).open).to.equal(false)
  })

  it('opens straight into editing', async () => {
    const el = await show()
    await el.edit(setlist())
    await el.updateComplete
    expect(form(el)).to.not.equal(null)
    expect(modal(el).heading).to.contain('Edit: ')
    el.close()
  })

  it('edits with the pencil, and goes back without saving on cancel', async () => {
    const el = await show()
    await el.show(setlist())
    editButton(el)?.click()
    await el.updateComplete
    expect(form(el)).to.not.equal(null)
    expect(editButton(el)).to.equal(null)
    let saved = 0
    el.addEventListener(SetlistInfoSaveEvent.type, () => saved++)
    form(el)?.dispatchEvent(new SetlistDetailsCancelEvent())
    await el.updateComplete
    expect(form(el)).to.equal(null)
    expect(saved).to.equal(0)
    el.close()
  })

  it('has no pencil for a setlist received by link', async () => {
    const el = await show()
    el.readonly = true
    await el.show(setlist())
    expect(editButton(el)).to.equal(null)
    el.close()
  })

  it('stops editing when it is closed', async () => {
    const el = await show()
    await el.edit(setlist())
    await el.updateComplete
    el.close()
    await settle()
    await el.updateComplete
    expect(form(el)).to.equal(null)
  })

  it('says the details that were saved, and for which setlist', async () => {
    const el = await show()
    await el.edit(setlist())
    await el.updateComplete
    const seen: SetlistInfoSaveEvent[] = []
    el.addEventListener(SetlistInfoSaveEvent.type, event =>
      seen.push(event as SetlistInfoSaveEvent)
    )
    const details = {
      date: '2026-11-01',
      time: '',
      type: 'Event',
      name: 'New',
      owner: '',
      ownerId: '',
    }
    form(el)?.dispatchEvent(new SetlistDetailsSaveEvent(details))
    expect(seen).to.have.length(1)
    expect(seen[0].setlistId).to.equal('sl-1')
    expect(seen[0].changes).to.deep.equal(details)
    el.close()
  })

  it('does nothing with a save when it has no setlist', async () => {
    const el = await show()
    let saved = 0
    el.addEventListener(SetlistInfoSaveEvent.type, () => saved++)
    el._save(new SetlistDetailsSaveEvent({} as never))
    expect(saved).to.equal(0)
  })

  it('offers to delete a setlist that is not in Drive, and says it was asked to', async () => {
    const el = await show()
    await el.edit(setlist())
    await el.updateComplete
    const seen: string[] = []
    el.addEventListener(SetlistInfoDeleteEvent.type, event =>
      seen.push((event as SetlistInfoDeleteEvent).setlistId)
    )
    el.shadowRoot?.querySelector<HTMLButtonElement>('.delete-setlist button')?.click()
    expect(seen).to.deep.equal(['sl-1'])
    el.close()
  })

  it('says why a setlist in Drive cannot be deleted here, and does not delete it', async () => {
    const el = await show()
    await el.edit(setlist({ fileRef: 'drive-1' }))
    await el.updateComplete
    expect(el.shadowRoot?.querySelector('.delete-setlist')?.textContent).to.contain(
      'in Google Drive'
    )
    expect(el.shadowRoot?.querySelector('.delete-setlist button')).to.equal(null)
    let deleted = 0
    el.addEventListener(SetlistInfoDeleteEvent.type, () => deleted++)
    el._delete()
    expect(deleted).to.equal(0)
    el.close()
  })

  it('has nothing to delete without a setlist', async () => {
    const el = await show()
    expect(el._deletable()).to.equal(false)
    el._delete()
  })
})

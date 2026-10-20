import { expect, fixture, html } from '@open-wc/testing'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  setCurrentSpace,
  setSpaceReadOnly,
} from '../src/js/space.ts'
import type { ImportSetlistView } from '../src/js/views/import-setlist-view.ts'
import { suppressConsoleLogs } from './test-helpers.ts'
import '../src/js/views/import-setlist-view.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('import-setlist-view', () => {
  let before: { id: string | null; name: string }
  let spaceId: string

  beforeEach(async () => {
    before = getCurrentSpace()
    const space = await createSpace(`Import ${crypto.randomUUID().slice(0, 8)}`)
    spaceId = space.id
    await setCurrentSpace(space.id, space.name)
  })

  afterEach(async () => {
    await setSpaceReadOnly(spaceId, false)
    await deleteSpace(spaceId)
    if (before.id) await setCurrentSpace(before.id, before.name)
  })

  it('offers the email import', async () => {
    const view = await fixture<ImportSetlistView>(html`<import-setlist-view></import-setlist-view>`)
    expect(view.querySelector('setlist-email-import')).to.not.equal(null)
  })

  it('still imports into a view-only space: the setlist stays on this device', async () => {
    await setSpaceReadOnly(spaceId, true)
    const view = await fixture<ImportSetlistView>(html`<import-setlist-view></import-setlist-view>`)
    expect(view.querySelector('setlist-email-import')).to.not.equal(null)
  })
})

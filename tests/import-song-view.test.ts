import { expect } from '@open-wc/testing'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  setCurrentSpace,
  setSpaceReadOnly,
} from '../src/js/space.ts'
import '../src/js/views/import-song-view.ts'
import type { ImportSongView } from '../src/js/views/import-song-view.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('the import song view', () => {
  let before: { id: string | null; name: string }
  let spaceId: string
  let view: ImportSongView

  beforeEach(async () => {
    before = getCurrentSpace()
    const space = await createSpace(`Import ${crypto.randomUUID().slice(0, 8)}`)
    spaceId = space.id
    await setCurrentSpace(space.id, space.name)
  })

  afterEach(async () => {
    view?.remove()
    await deleteSpace(spaceId)
    if (before.id) await setCurrentSpace(before.id, before.name)
  })

  async function show() {
    view = document.createElement('import-song-view')
    document.body.append(view)
    await view.updateComplete
  }

  it('offers the import form', async () => {
    await show()
    expect(view.querySelector('song-import')).to.not.equal(null)
  })

  it('still offers the form when the space is view-only', async () => {
    await setSpaceReadOnly(spaceId, true)
    await show()
    expect(view.querySelector('song-import')).to.not.equal(null)
  })
})

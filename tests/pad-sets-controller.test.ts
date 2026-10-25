import { expect, waitUntil } from '@open-wc/testing'
import { LitElement } from 'lit'
import { ensurePadSetFolder, uploadPadFile } from '../src/js/drive-api.ts'
import { PAD_FILE_KEYS } from '../src/js/pad-keys.ts'
import {
  getActivePadSet,
  listPadSets,
  PadSetChangedEvent,
  PadSetListUpdatedEvent,
} from '../src/js/pad-set-service.ts'
import { PadSetsController } from '../src/js/pad-sets-controller.ts'
import { makePadSet } from './builders.ts'
import { installFakeDrive } from './fake-drive.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, afterEach } = window

suppressConsoleLogs()

class PadSetsHost extends LitElement {
  padSets: any

  renders: any
  constructor() {
    super()
    this.padSets = new PadSetsController(this)
    this.renders = 0
  }

  override render() {
    this.renders++
    return ''
  }
}
customElements.define('pad-sets-host', PadSetsHost)

describe('PadSetsController', () => {
  let host

  afterEach(() => host?.remove())

  const settle = () => new Promise(resolve => setTimeout(resolve, 50))

  async function setUp() {
    host = document.createElement('pad-sets-host')
    document.body.appendChild(host)
    // (listing asks for the sign-in, which is read from the database: however long that takes)
    await waitUntil(() => !host.padSets.loading, 'the pad sets to load')
    return host.padSets
  }

  it('loads the pad sets when its host connects', async () => {
    const padSets = await setUp()
    expect(padSets.loading).to.equal(false)
    expect(padSets.list).to.deep.equal([])
    expect(padSets.activeId).to.be.a('string')
  })

  it('follows the active pad set when it changes elsewhere, updating its host', async () => {
    const padSets = await setUp()
    const renders = host.renders
    window.dispatchEvent(
      new PadSetChangedEvent(makePadSet({ id: 'drive-warm', name: 'Warm Pads' }))
    )
    await host.updateComplete
    expect(padSets.activeId).to.equal('drive-warm')
    expect(host.renders).to.be.above(renders)
  })

  it('reloads the list when pad sets are added', async () => {
    const padSets = await setUp()
    padSets.list = []
    window.dispatchEvent(new PadSetListUpdatedEvent())
    await settle()
    expect(padSets.list).to.deep.equal([])
  })

  it('stops listening when its host disconnects', async () => {
    const padSets = await setUp()
    const before = padSets.activeId
    host.remove()
    window.dispatchEvent(new PadSetChangedEvent(makePadSet({ id: 'drive-other', name: 'Other' })))
    expect(padSets.activeId).to.equal(before)
  })

  it('goes back to the active pad set when the one it showed as active is not in the list', async () => {
    const padSets = await setUp()
    padSets.activeId = 'drive-gone'
    await padSets.load()
    expect(padSets.activeId).to.equal(getActivePadSet()?.id ?? '')
  })

  it('starts with the pad set chosen on this device, and goes back to it', async () => {
    localStorage.setItem('padset-selection', JSON.stringify({ id: 'drive-chosen', name: 'Chosen' }))
    try {
      const padSets = await setUp()
      expect(padSets.activeId).to.equal('drive-chosen')
      padSets.activeId = 'drive-gone'
      await padSets.load()
      expect(padSets.activeId).to.equal('drive-chosen')
    } finally {
      localStorage.removeItem('padset-selection')
    }
  })

  describe('choosing a pad set', () => {
    let drive: ReturnType<typeof installFakeDrive>
    afterEach(async () => {
      await caches.delete('padsets-cache-v1')
      localStorage.removeItem('padset-cache-state')
      localStorage.removeItem('padset-selection')
      await listPadSets(true)
      drive?.uninstall()
    })

    it('shows the chosen set as active, and is not switching once it is', async () => {
      drive = installFakeDrive()
      const folderId = await ensurePadSetFolder('A whole set')
      for (const key of PAD_FILE_KEYS) {
        await uploadPadFile(folderId, key, new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }))
      }
      const padSets = await setUp()
      await padSets.load(true)
      await padSets.select(folderId)
      expect(padSets.activeId).to.equal(folderId)
      expect(padSets.switching).to.equal(false)
      expect(padSets.error).to.equal('')
    })

    it('goes back to the set it had, and says why, when the new one cannot be used', async () => {
      drive = installFakeDrive()
      const folderId = await ensurePadSetFolder('Half a set')
      await uploadPadFile(folderId, 'A', new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }))
      const padSets = await setUp()
      await padSets.load(true)
      const before = padSets.activeId
      expect(padSets.list.map(set => set.id)).to.include(folderId)

      let failure: unknown
      await padSets.select(folderId).catch(error => {
        failure = error
      })

      expect((failure as Error).message).to.contain('missing files')
      expect(padSets.activeId).to.equal(before)
      expect(padSets.error).to.contain('missing files')
      expect(padSets.switching).to.equal(false)
    })
  })
})

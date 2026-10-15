/**
 * The pad set manager on the preferences page: the pad sets there are and which one is the
 * default, and uploading a new one from a zip file (to a fake Drive).
 */

import { expect } from '@open-wc/testing'
import '../src/components/pad-set-manager.ts'
import type { PadSetManager } from '../src/components/pad-set-manager.ts'
import { PAD_FILE_KEYS } from '../src/js/pad-keys.ts'
import { listPadSets } from '../src/js/pad-set-service.ts'
import { installFakeDrive } from './fake-drive.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'
import { buildZip } from './zip.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('the pad set manager', () => {
  let drive: ReturnType<typeof installFakeDrive>
  let manager: PadSetManager
  let realError: typeof console.error

  const root = () => must(manager.shadowRoot)
  const text = () => root().textContent?.replace(/\s+/g, ' ') ?? ''
  const nameField = () => must(root().querySelector<HTMLInputElement>('#padset-name'))
  const fileField = () => must(root().querySelector<HTMLInputElement>('#padset-file-input'))
  const button = () => must(root().querySelector<HTMLButtonElement>('button[type="submit"]'))

  /** A zip with a pad for each key, named as a pad maker would */
  const padZip = (name = 'Warm_Pads.zip') =>
    buildZip(
      PAD_FILE_KEYS.map(key => ({ name: `Warm - ${key}.mp3`, data: new Uint8Array([1, 2, 3]) })),
      name
    )

  /** Choose a file in the file field, as the file picker does */
  function choose(file: File | null) {
    const transfer = new DataTransfer()
    if (file) transfer.items.add(file)
    fileField().files = transfer.files
    fileField().dispatchEvent(new Event('change'))
  }

  async function show() {
    manager = document.createElement('pad-set-manager')
    document.body.append(manager)
    for (let i = 0; i < 100 && manager._padSets.loading; i++) await wait(10)
    await manager.updateComplete
  }

  beforeEach(() => {
    drive = installFakeDrive()
    realError = console.error
    console.error = () => {}
  })

  afterEach(async () => {
    manager?.remove()
    console.error = realError
    await caches.delete('padsets-cache-v1')
    localStorage.removeItem('padset-cache-state')
    localStorage.removeItem('padset-selection')
    // (the list the service keeps would have this test's sets in it)
    await listPadSets(true)
    drive.uninstall()
  })

  describe('the list', () => {
    it('shows the built-in set, as chosen', async () => {
      await show()
      expect(text()).to.contain('Built-in Pads')
      expect(text()).to.contain('Built-in')
      expect(
        root().querySelectorAll<HTMLInputElement>('input[type="radio"]:checked')
      ).to.have.length(1)
    })

    it('says it is loading, and shows an error if the list could not be had', async () => {
      await show()
      manager._padSets.loading = true
      manager.requestUpdate()
      await manager.updateComplete
      expect(text()).to.contain('Loading pad sets…')

      manager._padSets.loading = false
      manager._padSets.error = 'Unable to load pad sets.'
      manager.requestUpdate()
      await manager.updateComplete
      expect(root().querySelector('.status-message.error')?.textContent).to.contain(
        'Unable to load pad sets.'
      )
    })

    it('says so when there are no sets', async () => {
      await show()
      manager._padSets.list = []
      manager.requestUpdate()
      await manager.updateComplete
      expect(text()).to.contain('No pad sets available yet.')
    })

    it('shows a set from Drive as custom, with when it was updated', async () => {
      await show()
      manager._padSets.list = [
        ...manager._padSets.list,
        { id: 'drive-1', name: 'Warm Pads', type: 'drive', modifiedTime: '2026-10-14T12:00:00Z' },
        { id: 'drive-2', name: 'Cold Pads', type: 'drive' },
      ]
      manager.requestUpdate()
      await manager.updateComplete

      expect(text()).to.contain('Warm Pads')
      expect(text()).to.match(/Custom Drive Pad Set • Updated/)
      expect(text()).to.contain('Cold Pads')
      expect(text().match(/Updated/g)).to.have.length(1)
    })
  })

  describe('choosing the default', () => {
    it('says it was updated', async () => {
      await show()
      manager._padSets.select = async () => {}
      root()
        .querySelector<HTMLInputElement>('input[type="radio"]')
        ?.dispatchEvent(new Event('change', { bubbles: true }))
      await wait(10)
      await manager.updateComplete
      expect(text()).to.contain('Default pad set updated.')
    })

    it('says why not when it could not be changed, or a general reason if there is none', async () => {
      await show()
      const radio = must(root().querySelector<HTMLInputElement>('input[type="radio"]'))

      manager._padSets.select = async () => {
        throw new Error('Pad set is missing files for: C#')
      }
      radio.dispatchEvent(new Event('change', { bubbles: true }))
      await wait(10)
      await manager.updateComplete
      expect(root().querySelector('.padset-message.error')?.textContent).to.contain(
        'missing files for: C#'
      )

      manager._padSets.select = async () => {
        throw new Error('')
      }
      radio.dispatchEvent(new Event('change', { bubbles: true }))
      await wait(10)
      await manager.updateComplete
      expect(root().querySelector('.padset-message.error')?.textContent).to.contain(
        'Unable to set pad set.'
      )
      expect(text()).to.not.contain('Default pad set updated.')
    })
  })

  describe('the name', () => {
    it('is kept as typed when it is letters, numbers, spaces and dashes', async () => {
      await show()
      nameField().value = 'Warm Pads - 2'
      nameField().dispatchEvent(new Event('input'))
      expect(manager._padSetName).to.equal('Warm Pads - 2')
      expect(nameField().value).to.equal('Warm Pads - 2')
    })

    it('has anything else taken out, keeping the cursor where it was', async () => {
      await show()
      nameField().value = 'Warm! Pads'
      nameField().setSelectionRange(5, 5)
      nameField().dispatchEvent(new Event('input'))
      expect(manager._padSetName).to.equal('Warm Pads')
      expect(nameField().value).to.equal('Warm Pads')
      expect(nameField().selectionStart).to.equal(4)
    })
  })

  describe('the file', () => {
    it('is shown when chosen, and names the set when it has no name yet', async () => {
      await show()
      choose(await padZip('Warm_Pads.zip'))
      await manager.updateComplete
      expect(text()).to.contain('Selected: Warm_Pads.zip')
      expect(manager._padSetName).to.equal('Warm Pads')
      expect(button().disabled).to.equal(false)
    })

    it('does not rename a set the user has named, but does the default name', async () => {
      await show()
      manager._padSetName = 'My pads'
      choose(await padZip('Other.zip'))
      expect(manager._padSetName).to.equal('My pads')

      manager._padSetName = 'New Pad Set'
      choose(await padZip('Third.zip'))
      expect(manager._padSetName).to.equal('Third')
    })

    it('is let go when the choice is cancelled, and the upload cannot be started', async () => {
      await show()
      choose(await padZip())
      await manager.updateComplete
      choose(null)
      await manager.updateComplete
      expect(text()).to.not.contain('Selected:')
      expect(button().disabled).to.equal(true)
    })
  })

  describe('uploading', () => {
    it('asks for a file when there is none', async () => {
      await show()
      root()
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { cancelable: true }))
      await manager.updateComplete
      expect(root().querySelector('.status-message.error')?.textContent).to.contain(
        'Please select a ZIP file to upload.'
      )
    })

    it('uploads the set, says so, clears the form, and lists the new set', async () => {
      await show()
      choose(await padZip('Warm_Pads.zip'))
      await manager.updateComplete

      root()
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { cancelable: true }))
      await manager.updateComplete
      expect(button().textContent).to.contain('Uploading…')
      expect(fileField().disabled).to.equal(true)

      for (let i = 0; i < 200 && !manager._successMessage; i++) await wait(10)
      await wait(20)
      await manager.updateComplete

      expect(text()).to.contain('Pad set uploaded successfully.')
      expect(text()).to.contain('Warm Pads')
      expect(manager._padSetName).to.equal('')
      expect(fileField().value).to.equal('')
      expect(text()).to.not.contain('Selected:')
      expect(button().textContent).to.contain('Upload Pad Set')
    })

    it('says what went wrong when the upload fails', async () => {
      await show()
      choose(await buildZip([{ name: 'Warm - C.mp3', data: new Uint8Array([1]) }]))
      await manager.updateComplete

      root()
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { cancelable: true }))
      for (let i = 0; i < 200 && !manager._error; i++) await wait(10)
      await manager.updateComplete

      expect(root().querySelector('.status-message.error')?.textContent).to.contain(
        'Missing keys in pad set'
      )
      expect(text()).to.not.contain('uploaded successfully')
      expect(button().textContent).to.contain('Upload Pad Set')
    })
  })
})

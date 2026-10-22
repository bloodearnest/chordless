/**
 * Uploading a pad set (pad-set-upload.ts): the name, the zip file, and the upload itself, to a fake
 * Drive. It is the form under the pad select on the media player page.
 */

import { expect } from '@open-wc/testing'
import '../src/components/pad-set-upload.ts'
import { type PadSetUpload, PadSetUploadedEvent } from '../src/components/pad-set-upload.ts'
import { PAD_FILE_KEYS } from '../src/js/pad-keys.ts'
import { listPadSets } from '../src/js/pad-set-service.ts'
import { installFakeDrive } from './fake-drive.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'
import { buildZip } from './zip.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('the pad set upload', () => {
  let drive: ReturnType<typeof installFakeDrive>
  let form: PadSetUpload
  let uploaded: number

  const root = () => must(form.shadowRoot)
  const text = () => root().textContent?.replace(/\s+/g, ' ') ?? ''
  const nameField = () => must(root().querySelector<HTMLInputElement>('#padset-name'))
  const fileField = () => must(root().querySelector<HTMLInputElement>('#padset-file-input'))
  const button = () => must(root().querySelector<HTMLButtonElement>('button[type="submit"]'))
  const submit = () =>
    root()
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }))

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
    form = document.createElement('pad-set-upload')
    form.addEventListener(PadSetUploadedEvent.type, () => uploaded++)
    document.body.append(form)
    await form.updateComplete
  }

  beforeEach(() => {
    drive = installFakeDrive()
    uploaded = 0
  })

  afterEach(async () => {
    form?.remove()
    await caches.delete('padsets-cache-v1')
    localStorage.removeItem('padset-cache-state')
    localStorage.removeItem('padset-selection')
    // (the list the service keeps would have this test's sets in it)
    await listPadSets(true)
    drive.uninstall()
  })

  describe('the name', () => {
    it('is kept as typed when it is letters, numbers, spaces and dashes', async () => {
      await show()
      nameField().value = 'Warm Pads - 2'
      nameField().dispatchEvent(new Event('input'))
      expect(form._padSetName).to.equal('Warm Pads - 2')
      expect(nameField().value).to.equal('Warm Pads - 2')
    })

    it('has anything else taken out, keeping the cursor where it was', async () => {
      await show()
      nameField().value = 'Warm! Pads'
      nameField().setSelectionRange(5, 5)
      nameField().dispatchEvent(new Event('input'))
      expect(form._padSetName).to.equal('Warm Pads')
      expect(nameField().value).to.equal('Warm Pads')
      expect(nameField().selectionStart).to.equal(4)
    })
  })

  describe('the file', () => {
    it('is shown when chosen, and names the set when it has no name yet', async () => {
      await show()
      choose(await padZip('Warm_Pads.zip'))
      await form.updateComplete
      expect(text()).to.contain('Selected: Warm_Pads.zip')
      expect(form._padSetName).to.equal('Warm Pads')
      expect(button().disabled).to.equal(false)
    })

    it('does not rename a set the user has named, but does the default name', async () => {
      await show()
      form._padSetName = 'My pads'
      choose(await padZip('Other.zip'))
      expect(form._padSetName).to.equal('My pads')

      form._padSetName = 'New Pad Set'
      choose(await padZip('Third.zip'))
      expect(form._padSetName).to.equal('Third')
    })

    it('is let go when the choice is cancelled, and the upload cannot be started', async () => {
      await show()
      choose(await padZip())
      await form.updateComplete
      choose(null)
      await form.updateComplete
      expect(text()).to.not.contain('Selected:')
      expect(button().disabled).to.equal(true)
    })
  })

  describe('uploading', () => {
    it('asks for a file when there is none', async () => {
      await show()
      submit()
      await form.updateComplete
      expect(root().querySelector('.status-message.error')?.textContent).to.contain(
        'Please select a ZIP file to upload.'
      )
      expect(uploaded).to.equal(0)
    })

    it('uploads the set, clears the form, and tells whoever shows it', async () => {
      await show()
      choose(await padZip('Warm_Pads.zip'))
      await form.updateComplete

      submit()
      await form.updateComplete
      expect(button().textContent).to.contain('Uploading…')
      expect(fileField().disabled).to.equal(true)
      expect(root().querySelector('progress')).to.not.equal(null)

      for (let i = 0; i < 200 && uploaded === 0; i++) await wait(10)
      await wait(20)
      await form.updateComplete

      expect(uploaded).to.equal(1)
      expect(form._padSetName).to.equal('')
      expect(fileField().value).to.equal('')
      expect(text()).to.not.contain('Selected:')
      expect(button().textContent).to.contain('Upload pad set')
      expect(root().querySelector('progress')).to.equal(null)
      expect((await listPadSets(true)).map(set => set.name)).to.include('Warm Pads')
    })

    it('shows how many pads are uploaded as it goes', async () => {
      await show()
      form._uploading = true
      form._progress = { done: 3, total: 12 }
      await form.updateComplete
      const bar = must(root().querySelector('progress'))
      expect(bar.value).to.equal(3)
      expect(bar.max).to.equal(12)
    })

    it('says what went wrong when the upload fails', async () => {
      await show()
      choose(await buildZip([{ name: 'Warm - C.mp3', data: new Uint8Array([1]) }]))
      await form.updateComplete

      submit()
      for (let i = 0; i < 200 && !form._error; i++) await wait(10)
      await form.updateComplete

      expect(root().querySelector('.status-message.error')?.textContent).to.contain(
        'Missing keys in pad set'
      )
      expect(uploaded).to.equal(0)
      expect(button().textContent).to.contain('Upload pad set')
    })
  })
})

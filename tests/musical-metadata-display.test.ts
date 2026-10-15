import { expect, fixture, html } from '@open-wc/testing'
import '../src/components/musical-metadata-display.ts'
import {
  type MusicalMetadataDisplay,
  SongSettingsClickEvent,
} from '../src/components/musical-metadata-display.ts'

const { describe, it } = window

describe('musical-metadata-display', () => {
  async function show(set: Partial<MusicalMetadataDisplay> = {}) {
    const display = await fixture<MusicalMetadataDisplay>(
      html`<musical-metadata-display></musical-metadata-display>`
    )
    Object.assign(display, set)
    await display.updateComplete
    return display
  }
  const items = (display: MusicalMetadataDisplay) =>
    Array.from(display.shadowRoot?.querySelectorAll('.meta-item') ?? [], item =>
      item.textContent?.replace(/\s+/g, ' ').trim()
    )
  const box = (display: MusicalMetadataDisplay) =>
    display.shadowRoot?.querySelector('.metadata-container') as HTMLElement

  it('shows what is known of the song: key, capo, tempo and time', async () => {
    const display = await show({ keyValue: 'G', capoValue: 2, bpm: 90, timeSignature: '3/4' })
    expect(items(display)).to.deep.equal(['Key: G', 'Capo: 2', 'BPM: 90', 'Time: 3/4'])
  })

  it('leaves out what is not known, and the capo when there is none', async () => {
    expect(items(await show())).to.deep.equal([])
    expect(items(await show({ keyValue: 'D', capoValue: 0 }))).to.deep.equal(['Key: D'])
    expect(items(await show({ bpm: 70 }))).to.deep.equal(['BPM: 70'])
    expect(items(await show({ timeSignature: '6/8' }))).to.deep.equal(['Time: 6/8'])
  })

  it('is information to read, and not to press, outside edit mode', async () => {
    const display = await show({ keyValue: 'G' })
    expect(box(display).getAttribute('role')).to.equal('group')
    expect(box(display).getAttribute('aria-label')).to.equal('Song information')
    expect(box(display).getAttribute('tabindex')).to.equal('-1')
    let opened = 0
    display.addEventListener(SongSettingsClickEvent.type, () => opened++)
    box(display).click()
    box(display).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(opened).to.equal(0)
  })

  it('is a button to the song’s settings in edit mode, by click or Enter or Space', async () => {
    const display = await show({ keyValue: 'G', editMode: true })
    expect(box(display).getAttribute('role')).to.equal('button')
    expect(box(display).getAttribute('aria-label')).to.equal('Open song settings')
    expect(box(display).getAttribute('tabindex')).to.equal('0')
    let opened = 0
    display.addEventListener(SongSettingsClickEvent.type, () => opened++)

    box(display).click()
    for (const key of ['Enter', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      box(display).dispatchEvent(event)
      expect(event.defaultPrevented, key).to.equal(true)
    }
    expect(opened).to.equal(3)

    const other = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    box(display).dispatchEvent(other)
    expect(opened).to.equal(3)
    expect(other.defaultPrevented).to.equal(false)
  })
})

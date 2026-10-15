import { expect, fixture, html } from '@open-wc/testing'
import {
  BpmChangeEvent,
  PadSetChoiceEvent,
  SongResetClickEvent,
  type SongSettingsPopover,
} from '../src/components/song-settings-popover.ts'
import { settle } from './test-helpers.ts'
import '../src/components/song-settings-popover.ts'

const { describe, it } = window

describe('song-settings-popover', () => {
  const show = () =>
    fixture<SongSettingsPopover>(html`<song-settings-popover></song-settings-popover>`)
  const button = (el: SongSettingsPopover, label: string) =>
    el.shadowRoot?.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement

  describe('the BPM', () => {
    it('steps down and up by one, and says the new value', async () => {
      const el = await show()
      const seen: number[] = []
      el.addEventListener(BpmChangeEvent.type, event => seen.push((event as BpmChangeEvent).value))
      el.bpmValue = 100
      await el.updateComplete
      button(el, 'Decrease BPM').click()
      button(el, 'Increase BPM').click()
      expect(seen).to.deep.equal([99, 101])
      expect(el.shadowRoot?.querySelector('.bpm-value')?.textContent).to.equal('100')
    })

    it('stops at its limits', async () => {
      const el = await show()
      const seen: number[] = []
      el.addEventListener(BpmChangeEvent.type, event => seen.push((event as BpmChangeEvent).value))
      el.bpmValue = el.bpmMin
      await el.updateComplete
      expect(button(el, 'Decrease BPM').disabled).to.equal(true)
      el._handleBPMDecrement()
      el.bpmValue = el.bpmMax
      await el.updateComplete
      expect(button(el, 'Increase BPM').disabled).to.equal(true)
      el._handleBPMIncrement()
      expect(seen).to.deep.equal([])
    })

    it('cannot be changed when it is locked, and shows a dash for none', async () => {
      const el = await show()
      el.bpmLocked = true
      el.bpmValue = 0
      await el.updateComplete
      expect(button(el, 'Decrease BPM').disabled).to.equal(true)
      expect(button(el, 'Increase BPM').disabled).to.equal(true)
      expect(el.shadowRoot?.querySelector('.bpm-value')?.textContent).to.equal('—')
    })
  })

  describe('the pad set', () => {
    it('is not offered unless the media player is', async () => {
      const el = await show()
      expect(el.shadowRoot?.querySelector('#pad-set-choice')).to.equal(null)
    })

    it('offers the default and each set, with the song’s own chosen', async () => {
      const el = await show()
      el.mediaAvailable = true
      el.padSets = [
        { id: 'a', name: 'Warm' },
        { id: 'b', name: 'Cool' },
      ] as SongSettingsPopover['padSets']
      el.padSetId = 'b'
      await el.updateComplete
      const select = el.shadowRoot?.querySelector('#pad-set-choice') as HTMLSelectElement
      expect([...select.options].map(option => option.textContent?.trim())).to.deep.equal([
        'Default',
        'Warm',
        'Cool',
      ])
      expect(select.value).to.equal('b')
    })

    it('has the default chosen when the song has no choice', async () => {
      const el = await show()
      el.mediaAvailable = true
      el.padSets = [{ id: 'a', name: 'Warm' }] as SongSettingsPopover['padSets']
      await el.updateComplete
      const select = el.shadowRoot?.querySelector<HTMLSelectElement>('#pad-set-choice')
      expect(select?.value).to.equal('')
    })

    it('still shows a chosen set that is no longer on this device', async () => {
      const el = await show()
      el.mediaAvailable = true
      el.padSets = [{ id: 'a', name: 'Warm' }] as SongSettingsPopover['padSets']
      el.padSetId = 'gone'
      await el.updateComplete
      const select = el.shadowRoot?.querySelector('#pad-set-choice') as HTMLSelectElement
      expect(select.selectedOptions[0].textContent?.trim()).to.equal('Not on this device')
    })

    it('says which set was chosen, or none for the default', async () => {
      const el = await show()
      el.mediaAvailable = true
      el.padSets = [{ id: 'a', name: 'Warm' }] as SongSettingsPopover['padSets']
      await el.updateComplete
      const seen: Array<string | undefined> = []
      el.addEventListener(PadSetChoiceEvent.type, event =>
        seen.push((event as PadSetChoiceEvent).value)
      )
      const select = el.shadowRoot?.querySelector('#pad-set-choice') as HTMLSelectElement
      select.value = 'a'
      select.dispatchEvent(new Event('change'))
      select.value = ''
      select.dispatchEvent(new Event('change'))
      expect(seen).to.deep.equal(['a', undefined])
    })
  })

  it('says when Reset is pressed', async () => {
    const el = await show()
    let resets = 0
    el.addEventListener(SongResetClickEvent.type, () => resets++)
    button(el, 'Reset song').click()
    expect(resets).to.equal(1)
  })

  describe('as a popup', () => {
    it('opens under its trigger, and closes', async () => {
      const container = await fixture(html`
        <div>
          <button id="trigger" style="position: fixed; top: 10px; left: 20px; height: 30px">Settings</button>
          <song-settings-popover></song-settings-popover>
        </div>
      `)
      const el = container.querySelector('song-settings-popover') as SongSettingsPopover
      await el.updateComplete
      el.setTriggerButton(container.querySelector('#trigger'))
      expect(el.isOpen()).to.equal(false)
      el.show()
      await settle()
      expect(el.isOpen()).to.equal(true)
      expect(el.dialog?.style.top).to.equal('44px')
      el.close()
      await settle()
      expect(el.isOpen()).to.equal(false)
      el.toggle()
      await settle()
      expect(el.isOpen()).to.equal(true)
      el.toggle()
    })

    it('opens where it is without a trigger', async () => {
      const el = await show()
      el.show()
      await settle()
      expect(el.isOpen()).to.equal(true)
      el.close()
    })
  })
})

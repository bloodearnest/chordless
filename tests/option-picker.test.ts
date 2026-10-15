/** The option picker both the key and the capo selector are made from, with a picker of its own */

import { expect } from '@open-wc/testing'
import { OptionPicker, type PickerOption } from '../src/components/option-picker.ts'
import { settle } from './test-helpers.ts'

const { describe, it, afterEach } = window

class ChosenEvent extends Event {
  value: string
  constructor(value: string) {
    super('test-picker:chosen')
    this.value = value
  }
}

class TestPicker extends OptionPicker<string> {
  static override properties = { ...OptionPicker.properties, value: { type: String } }

  _options(): PickerOption<string>[] {
    return ['one', 'two', 'three'].map(value => ({ value, label: value, hint: `hint ${value}` }))
  }

  _changeEvent(value: string) {
    return new ChosenEvent(value)
  }
}
customElements.define('test-picker', TestPicker)

describe('the option picker', () => {
  let picker: TestPicker
  let host: HTMLElement

  async function show(place = 'top: 10px; left: 20px', attributes = '') {
    // (the picker itself takes no space of its own: the box is what is placed)
    host = document.createElement('div')
    host.style.cssText = `position: fixed; ${place}`
    host.innerHTML = `<test-picker ${attributes}></test-picker>`
    picker = host.firstElementChild as TestPicker
    document.body.append(host)
    await picker.updateComplete
    return picker
  }

  const button = () => picker.shadowRoot?.querySelector('.picker-button') as HTMLButtonElement
  const popover = () => picker.shadowRoot?.querySelector('.picker-popover') as HTMLDialogElement

  afterEach(() => host?.remove())

  it('shows a dash for no value, and the value otherwise', async () => {
    await show()
    expect(picker._displayValue()).to.equal('-')
    picker.value = 'two'
    await picker.updateComplete
    expect(button().textContent?.trim()).to.equal('two')
  })

  it('names the button after its label, and has no name of its own without one', async () => {
    await show()
    picker.value = 'two'
    await picker.updateComplete
    expect(button().hasAttribute('aria-label')).to.equal(false)
    expect(picker.shadowRoot?.querySelector('.meta-label')).to.equal(null)
    expect(popover().getAttribute('aria-label')).to.equal('Options')

    picker.label = 'Pick'
    await picker.updateComplete
    expect(button().getAttribute('aria-label')).to.equal('Pick: two')
    expect(picker.shadowRoot?.querySelector('.meta-label')?.textContent).to.equal('Pick:')
    expect(popover().getAttribute('aria-label')).to.equal('Pick')
  })

  it('sends the choice, and closes, when a different option is chosen', async () => {
    await show()
    picker.value = 'one'
    await picker.updateComplete
    const chosen: string[] = []
    picker.addEventListener('test-picker:chosen', event =>
      chosen.push((event as ChosenEvent).value)
    )

    button().click()
    await settle()
    expect(popover().open).to.equal(true)
    const options = picker.shadowRoot?.querySelectorAll<HTMLButtonElement>('.picker-option')
    options?.[1].click()
    await settle()

    expect(chosen).to.deep.equal(['two'])
    expect(popover().open).to.equal(false)
  })

  it('says nothing, and stays open, when the option chosen is the one it has', async () => {
    await show()
    picker.value = 'one'
    await picker.updateComplete
    const chosen: string[] = []
    picker.addEventListener('test-picker:chosen', event =>
      chosen.push((event as ChosenEvent).value)
    )

    button().click()
    await settle()
    picker.shadowRoot?.querySelectorAll<HTMLButtonElement>('.picker-option')[0].click()
    await settle()

    expect(chosen).to.deep.equal([])
    expect(popover().open).to.equal(true)
  })

  it('opens its popover above the button when there is more room there', async () => {
    await show('bottom: 5px; left: 20px')
    button().click()
    await settle()
    const rect = button().getBoundingClientRect()
    expect(popover().getBoundingClientRect().bottom).to.be.at.most(rect.top)
  })

  it('has nothing to position the popover by before it is shown', () => {
    const lone = new TestPicker()
    const dialog = document.createElement('dialog')
    lone._positionPopover(dialog)
    expect(dialog.style.top).to.equal('')
  })
})

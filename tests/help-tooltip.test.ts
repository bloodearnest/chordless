import { expect, fixture, html } from '@open-wc/testing'
import type { HelpTooltip } from '../src/components/help-tooltip.ts'
import '../src/components/help-tooltip.ts'

const { describe, it } = window

describe('help-tooltip', () => {
  async function show() {
    return fixture<HelpTooltip>(html`<help-tooltip message="Hint">?</help-tooltip>`)
  }
  const trigger = (el: HelpTooltip) => el.shadowRoot?.querySelector('.trigger') as HTMLElement
  const tooltip = (el: HelpTooltip) => el.shadowRoot?.querySelector('.tooltip') as HTMLElement
  const pointer = (type: string, pointerType: string, cancelable = false) =>
    new PointerEvent(type, { pointerType, bubbles: true, cancelable })

  it('has its message, hidden', async () => {
    const el = await show()
    expect(tooltip(el).textContent?.trim()).to.equal('Hint')
    expect(tooltip(el).classList.contains('visible')).to.equal(false)
  })

  it('shows for a mouse hovering, and hides when it leaves', async () => {
    const el = await show()
    trigger(el).dispatchEvent(pointer('pointerenter', 'mouse'))
    await el.updateComplete
    expect(tooltip(el).classList.contains('visible')).to.equal(true)
    trigger(el).dispatchEvent(pointer('pointerleave', 'mouse'))
    await el.updateComplete
    expect(tooltip(el).classList.contains('visible')).to.equal(false)
  })

  it('is not shown by a finger passing over it', async () => {
    const el = await show()
    trigger(el).dispatchEvent(pointer('pointerenter', 'touch'))
    await el.updateComplete
    expect(tooltip(el).classList.contains('visible')).to.equal(false)
    el._visible = true
    trigger(el).dispatchEvent(pointer('pointerleave', 'touch'))
    expect(el._visible).to.equal(true)
  })

  it('shows with the keyboard focus, and hides without it', async () => {
    const el = await show()
    trigger(el).dispatchEvent(new FocusEvent('focus'))
    await el.updateComplete
    expect(el._visible).to.equal(true)
    trigger(el).dispatchEvent(new FocusEvent('blur'))
    await el.updateComplete
    expect(el._visible).to.equal(false)
  })

  it('toggles with a touch, and the click that follows it does nothing more', async () => {
    const el = await show()
    const down = pointer('pointerdown', 'touch', true)
    trigger(el).dispatchEvent(down)
    expect(down.defaultPrevented).to.equal(true)
    expect(el._visible).to.equal(true)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    trigger(el).dispatchEvent(click)
    expect(click.defaultPrevented).to.equal(true)
    expect(el._visible).to.equal(true)
    // Touched again: hidden
    trigger(el).dispatchEvent(pointer('pointerdown', 'pen', true))
    expect(el._visible).to.equal(false)
  })

  it('hides on a click that is not after a touch, and ignores a mouse press', async () => {
    const el = await show()
    el._visible = true
    trigger(el).dispatchEvent(pointer('pointerdown', 'mouse', true))
    expect(el._visible).to.equal(true)
    trigger(el).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(el._visible).to.equal(false)
  })
})

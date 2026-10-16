import { expect, fixture, html } from '@open-wc/testing'
import type { LiveIndicator } from '../src/components/live-indicator.ts'
import '../src/components/live-indicator.ts'
import { RouteChangeEvent } from '../src/js/app-router.ts'
import { getLive, goLive, leaveLive } from '../src/js/live.ts'
import { A11Y, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('live-indicator', () => {
  beforeEach(() => localStorage.removeItem('live_state'))
  afterEach(() => localStorage.removeItem('live_state'))

  const show = () => fixture<LiveIndicator>(html`<live-indicator></live-indicator>`)
  const route = (el: LiveIndicator, songIndex: number, setlistId = 'a') => {
    document.dispatchEvent(new RouteChangeEvent({ name: 'setlist', setlistId, songIndex }, null))
    return el.updateComplete
  }

  it('is not there until live', async () => {
    const el = await show()
    expect(el.hidden).to.equal(true)
    expect(el.shadowRoot?.querySelector('.chip')).to.equal(null)
  })

  it('says it is live, with the setlist name, as soon as it goes live and no longer when it ends', async () => {
    const el = await show()
    goLive('/setlist/a', 'Sunday AM')
    await el.updateComplete
    expect(el.hidden).to.equal(false)
    expect(el.shadowRoot?.querySelector('.chip')?.textContent).to.contain('Live: Sunday AM')
    leaveLive()
    await el.updateComplete
    expect(el.hidden).to.equal(true)
  })

  it('is there from the start when the page opens live, with a name or without', async () => {
    goLive('/setlist/a', '')
    const el = await show()
    expect(
      el.shadowRoot?.querySelector('.chip')?.textContent?.replace(/\s+/g, ' ').trim()
    ).to.equal('Live')
  })

  it('stays out of the way on a song of the live setlist, not on its overview or elsewhere', async () => {
    goLive('/setlist/a', 'A')
    const el = await show()
    await route(el, 2)
    expect(el.hidden).to.equal(true)
    await route(el, -1)
    expect(el.hidden).to.equal(false)
    await route(el, 2, 'b')
    expect(el.hidden).to.equal(false)
    document.dispatchEvent(new RouteChangeEvent({ name: 'home' }, null))
    await el.updateComplete
    expect(el.hidden).to.equal(false)
  })

  it('opens a menu to go back to the live setlist or to leave, in two taps', async () => {
    goLive('/setlist/a', 'A')
    const el = await show()
    const menu = el.shadowRoot?.querySelector<HTMLElement>('.menu') as HTMLElement
    expect(menu.matches(':popover-open')).to.equal(false)
    el.shadowRoot?.querySelector<HTMLElement>('.chip')?.click()
    expect(menu.matches(':popover-open')).to.equal(true)
    expect(menu.querySelector('a')?.getAttribute('href')).to.equal('/setlist/a')

    menu.querySelector<HTMLElement>('#leave-live')?.click()
    await el.updateComplete
    expect(getLive()).to.equal(null)
    expect(el.hidden).to.equal(true)
  })

  it('is accessible', async () => {
    goLive('/setlist/a', 'Sunday AM')
    const el = await show()
    await expect(el).to.be.accessible(A11Y)
  })

  it('stops listening when removed', async () => {
    const el = await show()
    el.remove()
    goLive('/setlist/a', 'A')
    await el.updateComplete
    expect(el.hidden).to.equal(true)
  })
})

import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import {
  type AppHeader,
  EditModeToggleEvent,
  HeaderInfoClickEvent,
  HeaderMenuClickEvent,
} from '../src/components/app-header.ts'
import { AppUpdateChangeEvent } from '../src/js/app-update.ts'
import { wait } from './test-helpers.ts'
import '../src/components/app-header.ts'

import { must } from './must.ts'

const { describe, it } = window

describe('app-header', () => {
  const shownTitle = header => header.shadowRoot.querySelector('.title .wide').textContent.trim()

  it('has a shorter heading for a phone, and a row under it, which change with the heading', async () => {
    const header = await fixture<AppHeader>(
      html`<app-header heading="Sun 18 Oct - Harvest"></app-header>`
    )
    const narrow = () => header.shadowRoot?.querySelector('.title .narrow')?.textContent?.trim()
    const sub = () => header.shadowRoot?.querySelector('.subtitle')?.textContent?.trim()
    // Without a phone heading the one heading serves
    expect(narrow()).to.equal('Sun 18 Oct - Harvest')
    expect(sub()).to.equal(undefined)
    header.phoneHeading = '18 Oct'
    header.subheading = 'Harvest'
    await waitUntil(() => narrow() === '18 Oct' && sub() === 'Harvest', 'the texts change')
    // (nothing but the row under changes)
    header.subheading = 'Sunday'
    await waitUntil(() => sub() === 'Sunday', 'the row under changes')
    expect(narrow()).to.equal('18 Oct')
  })

  it('shows a new heading after fading the old one out', async () => {
    const header = await fixture<AppHeader>(html`<app-header heading="First"></app-header>`)
    expect(shownTitle(header)).to.equal('First')
    header.heading = 'Second'
    await waitUntil(() => shownTitle(header) === 'Second', 'the heading changes')
  })

  it('ends on the latest heading when it changes again while fading', async () => {
    const header = await fixture<AppHeader>(html`<app-header heading="First"></app-header>`)
    header.heading = 'Second'
    await wait(400) // mid-fade: Second is shown, fading in
    header.heading = 'Third'
    await waitUntil(() => shownTitle(header) === 'Third', 'the latest heading is shown')
  })

  it('shows a heading set with setTitleInstant at once, in a single update', async () => {
    const header = await fixture<AppHeader>(html`<app-header heading="First"></app-header>`)
    let updates = 0
    const element = header as unknown as { performUpdate(): unknown }
    const update = element.performUpdate.bind(header)
    element.performUpdate = () => {
      updates++
      return update()
    }
    header.setTitleInstant('Second')
    await header.updateComplete
    await wait(50)
    expect(shownTitle(header)).to.equal('Second')
    expect(updates).to.equal(1)
    // The next change fades as usual
    header.heading = 'Third'
    await waitUntil(() => shownTitle(header) === 'Third', 'the next change fades in')
  })

  describe('buttons', () => {
    const button = (header: AppHeader, selector: string) =>
      header.shadowRoot?.querySelector(selector) as HTMLButtonElement | null

    it('has only the menu button, and no second row of controls, by default', async () => {
      const header = await fixture<AppHeader>(html`<app-header heading="Plain"></app-header>`)
      expect(button(header, '.edit-toggle')).to.equal(null)
      expect(button(header, '.info-button')).to.equal(null)
      expect(header.shadowRoot?.querySelector<HTMLElement>('.header-row-2')?.hidden).to.equal(true)
      expect(header.shadowRoot?.querySelector('.logo')).to.equal(null)
      let menu: HeaderMenuClickEvent | null = null
      header.addEventListener(
        HeaderMenuClickEvent.type,
        event => (menu = event as HeaderMenuClickEvent)
      )
      button(header, '.nav-menu-button')?.click()
      expect(menu).to.not.equal(null)
      expect((menu as unknown as HeaderMenuClickEvent).trigger).to.equal(
        button(header, '.nav-menu-button')
      )
    })

    it('shows the logo when asked', async () => {
      const header = await fixture<AppHeader>(
        html`<app-header heading="Home" show-logo></app-header>`
      )
      expect(header.shadowRoot?.querySelector('.logo')).to.not.equal(null)
    })

    it('tells of the edit and info buttons being pressed', async () => {
      const header = await fixture<AppHeader>(
        html`<app-header heading="Page" show-edit-toggle show-info-button></app-header>`
      )
      const seen: string[] = []
      header.addEventListener(EditModeToggleEvent.type, () => seen.push('edit'))
      header.addEventListener(HeaderInfoClickEvent.type, () => seen.push('info'))
      button(header, '.edit-toggle')?.click()
      button(header, '.info-button')?.click()
      expect(seen).to.deep.equal(['edit', 'info'])
    })

    it('draws the info button’s i without a circle of its own: the button is the circle', async () => {
      const header = await fixture<AppHeader>(
        html`<app-header heading="Page" show-info-button></app-header>`
      )
      const icon = must(button(header, '.info-button')?.querySelector('app-icon'))
      await icon.updateComplete
      expect(icon.shadowRoot?.querySelector('svg circle')).to.equal(null)
      expect(icon.shadowRoot?.querySelector('svg path')).to.not.equal(null)
    })

    it('marks the edit button while in edit mode', async () => {
      const header = await fixture<AppHeader>(
        html`<app-header heading="Page" show-edit-toggle edit-mode></app-header>`
      )
      expect(button(header, '.edit-toggle')?.classList.contains('active')).to.equal(true)
    })

    it('shows the second row when something is in the controls slot', async () => {
      const header = await fixture<AppHeader>(
        html`<app-header heading="Page"><button slot="controls">Go</button></app-header>`
      )
      await header.updateComplete
      expect(header.shadowRoot?.querySelector<HTMLElement>('.header-row-2')?.hidden).to.equal(false)
    })

    it('shows a dot on the menu button while an update is waiting', async () => {
      const header = await fixture<AppHeader>(html`<app-header heading="Page"></app-header>`)
      expect(header.shadowRoot?.querySelector('.update-dot')).to.equal(null)
      window.dispatchEvent(new AppUpdateChangeEvent(true))
      await header.updateComplete
      expect(header.shadowRoot?.querySelector('.update-dot')).to.not.equal(null)
      expect(button(header, '.nav-menu-button')?.getAttribute('aria-label')).to.contain(
        'update ready'
      )
      header.remove()
      window.dispatchEvent(new AppUpdateChangeEvent(false))
    })
  })
})

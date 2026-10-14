import { expect, fixture, html } from '@open-wc/testing'
import type { AppHeader } from '../src/components/app-header.ts'
import { wait } from './test-helpers.ts'
import '../src/components/app-header.ts'

const { describe, it } = window

describe('app-header', () => {
  const shownTitle = header => header.shadowRoot.querySelector('.title').textContent.trim()

  it('shows a new heading after fading the old one out', async () => {
    const header = await fixture<AppHeader>(html`<app-header heading="First"></app-header>`)
    expect(shownTitle(header)).to.equal('First')
    header.heading = 'Second'
    await wait(800)
    expect(shownTitle(header)).to.equal('Second')
  })

  it('ends on the latest heading when it changes again while fading', async () => {
    const header = await fixture<AppHeader>(html`<app-header heading="First"></app-header>`)
    header.heading = 'Second'
    await wait(400) // mid-fade: Second is shown, fading in
    header.heading = 'Third'
    await wait(1500)
    expect(shownTitle(header)).to.equal('Third')
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
    await wait(800)
    expect(shownTitle(header)).to.equal('Third')
  })
})

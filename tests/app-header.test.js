import { expect, fixture, html } from '@open-wc/testing'
import '../public/components/app-header.js'

const { describe, it } = window

describe('app-header', () => {
  const shownTitle = header => header.shadowRoot.querySelector('.title').textContent.trim()
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

  it('shows a new heading after fading the old one out', async () => {
    const header = await fixture(html`<app-header heading="First"></app-header>`)
    expect(shownTitle(header)).to.equal('First')
    header.heading = 'Second'
    await wait(800)
    expect(shownTitle(header)).to.equal('Second')
  })

  it('ends on the latest heading when it changes again while fading', async () => {
    const header = await fixture(html`<app-header heading="First"></app-header>`)
    header.heading = 'Second'
    await wait(400) // mid-fade: Second is shown, fading in
    header.heading = 'Third'
    await wait(1500)
    expect(shownTitle(header)).to.equal('Third')
  })
})

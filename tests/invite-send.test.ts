/**
 * Handing an invite on (invite-send.ts, inviteSendLinks): the share sheet where the browser has
 * one, else WhatsApp and Gmail's compose window. Nothing is sent by Chordless.
 */
import { expect, fixture, html } from '@open-wc/testing'
import '../src/components/invite-send.ts'
import type { InviteSend } from '../src/components/invite-send.ts'
import { inviteMessage, inviteSendLinks } from '../src/js/team-spaces.ts'
import { must } from './must.ts'

const { describe, it, afterEach } = window

const URL = 'https://chordless.app/join#space.code'

const original = Object.getOwnPropertyDescriptor(navigator, 'share')
afterEach(() => {
  if (original) Object.defineProperty(navigator, 'share', original)
  else Reflect.deleteProperty(navigator, 'share')
})

const render = async () =>
  fixture<InviteSend>(
    html`<invite-send .teamName=${'Grace Church'} .role=${'writer'} .email=${'fay@example.com'} .url=${URL}></invite-send>`
  )

describe('inviteMessage and inviteSendLinks', () => {
  it('says who is invited, as what, and with which account', () => {
    expect(inviteMessage('Grace Church', 'reader', 'fay@example.com')).to.contain(
      'join Grace Church on Chordless as a team member. Sign in with the Google account fay@example.com'
    )
  })

  it('makes a WhatsApp link and a Gmail compose link to that address, both carrying the invite link', () => {
    const { whatsapp, gmail } = inviteSendLinks('Grace Church', 'writer', 'fay+x@example.com', URL)
    expect(whatsapp).to.match(/^https:\/\/wa\.me\/\?text=/)
    expect(decodeURIComponent(whatsapp)).to.contain(URL)
    expect(gmail).to.contain('to=fay%2Bx%40example.com')
    expect(decodeURIComponent(gmail)).to.contain(URL)
  })
})

describe('invite-send', () => {
  it('offers the share sheet where there is one, and hands it the link and the message', async () => {
    const shared: ShareData[] = []
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => void shared.push(data),
    })
    const element = await render()
    expect(element.shadowRoot?.querySelector('a')).to.equal(null)
    must(element.shadowRoot?.querySelector('button')).click()
    expect(shared).to.have.length(1)
    expect(shared[0].url).to.equal(URL)
    expect(shared[0].text).to.contain('Grace Church')
    expect(shared[0].text).to.contain('fay@example.com')
  })

  it('carries on when the share sheet is cancelled', async () => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => Promise.reject(new DOMException('cancelled', 'AbortError')),
    })
    const element = await render()
    must(element.shadowRoot?.querySelector('button')).click()
    await element.updateComplete
    expect(element.shadowRoot?.querySelector('button')).to.not.equal(null)
  })

  it('offers WhatsApp and Gmail where there is no share sheet', async () => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
    const element = await render()
    const links = Array.from(element.shadowRoot?.querySelectorAll('a') ?? [])
    expect(links.map(each => each.textContent?.trim())).to.deep.equal(['WhatsApp', 'Email (Gmail)'])
    for (const link of links) expect(link.rel).to.equal('noopener')
    expect(element.shadowRoot?.querySelector('button')).to.equal(null)
  })

  it('shows nothing without a link', async () => {
    const element = await fixture<InviteSend>(html`<invite-send></invite-send>`)
    expect(element.shadowRoot?.querySelector('a, button')).to.equal(null)
  })
})

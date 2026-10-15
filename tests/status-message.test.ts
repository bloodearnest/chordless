import { expect, fixture, html } from '@open-wc/testing'
import { render } from 'lit'
import '../src/components/status-message.ts'
import type { StatusMessage } from '../src/components/status-message.ts'
import { renderStatus } from '../src/components/status-view.ts'

const { describe, it } = window

describe('status-message', () => {
  const shown = (el: StatusMessage, selector: string) => el.shadowRoot?.querySelector(selector)

  it('shows the message and the detail it has, and no paragraph for the ones it has not', async () => {
    const bare = await fixture<StatusMessage>(html`<status-message></status-message>`)
    expect(shown(bare, '.message')).to.equal(null)
    expect(shown(bare, '.detail')).to.equal(null)

    const full = await fixture<StatusMessage>(
      html`<status-message message="Nothing here" detail="Add one"></status-message>`
    )
    expect(shown(full, '.message')?.textContent).to.equal('Nothing here')
    expect(shown(full, '.detail')?.textContent).to.equal('Add one')
  })

  it('is an alert for an error, and a polite status while loading', async () => {
    const error = await fixture<StatusMessage>(
      html`<status-message state="error"></status-message>`
    )
    expect(shown(error, '.status-card')?.getAttribute('role')).to.equal('alert')
    const loading = await fixture<StatusMessage>(
      html`<status-message state="loading"></status-message>`
    )
    expect(shown(loading, '.status-card')?.getAttribute('aria-live')).to.equal('polite')
  })
})

describe('renderStatus', () => {
  const look = { look: 'good', icon: 'check', label: 'Synced', detail: 'Just now' } as const

  it('shows the label and detail, with an id and state only if given', () => {
    const plain = document.createElement('div')
    render(renderStatus(look), plain)
    expect(plain.querySelector('.status-label')?.textContent).to.equal('Synced')
    expect(plain.querySelector('.status')?.getAttribute('id')).to.equal('')
    expect(plain.querySelector('.status')?.getAttribute('data-state')).to.equal('')

    const named = document.createElement('div')
    render(renderStatus(look, { id: 'sync', state: 'ok' }), named)
    expect(named.querySelector('#sync')?.getAttribute('data-state')).to.equal('ok')
  })
})

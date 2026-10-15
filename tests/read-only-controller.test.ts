import { expect } from '@open-wc/testing'
import { LitElement } from 'lit'
import { FollowsReadOnly, READ_ONLY_CHANGE } from '../src/js/read-only-controller.ts'

const { describe, it } = window

class FollowsHost extends LitElement {
  follows = new FollowsReadOnly(this)
  renders = 0
  override render() {
    this.renders++
    return ''
  }
}
customElements.define('follows-read-only-host', FollowsHost)

describe('FollowsReadOnly', () => {
  it('renders its host again when the organisation turns read-only or stops being', async () => {
    const host = document.createElement('follows-read-only-host') as FollowsHost
    document.body.append(host)
    await host.updateComplete
    const rendered = host.renders

    window.dispatchEvent(new Event(READ_ONLY_CHANGE))
    await host.updateComplete

    expect(host.renders).to.be.above(rendered)
    host.remove()
  })

  it('stops listening once its host is gone', async () => {
    const host = document.createElement('follows-read-only-host') as FollowsHost
    document.body.append(host)
    await host.updateComplete
    host.remove()
    const rendered = host.renders

    window.dispatchEvent(new Event(READ_ONLY_CHANGE))
    await host.updateComplete

    expect(host.renders).to.equal(rendered)
  })
})

import { expect } from '@esm-bundle/chai'
import { LitElement } from 'lit'
import { PadSetChangedEvent, PadSetListUpdatedEvent } from '../src/js/pad-set-service.ts'
import { PadSetsController } from '../src/js/pad-sets-controller.ts'

const { describe, it, afterEach } = window

class PadSetsHost extends LitElement {
  constructor() {
    super()
    this.padSets = new PadSetsController(this)
    this.renders = 0
  }

  render() {
    this.renders++
    return ''
  }
}
customElements.define('pad-sets-host', PadSetsHost)

describe('PadSetsController', () => {
  let host

  afterEach(() => host?.remove())

  const settle = () => new Promise(resolve => setTimeout(resolve, 50))

  async function setUp() {
    host = document.createElement('pad-sets-host')
    document.body.appendChild(host)
    await settle()
    return host.padSets
  }

  it('loads the pad sets when its host connects', async () => {
    const padSets = await setUp()
    expect(padSets.loading).to.equal(false)
    expect(padSets.list.map(set => set.id)).to.include('builtin')
    expect(padSets.activeId).to.be.a('string')
  })

  it('follows the active pad set when it changes elsewhere, updating its host', async () => {
    const padSets = await setUp()
    const renders = host.renders
    window.dispatchEvent(new PadSetChangedEvent({ id: 'drive-warm', name: 'Warm Pads' }))
    await host.updateComplete
    expect(padSets.activeId).to.equal('drive-warm')
    expect(host.renders).to.be.above(renders)
  })

  it('reloads the list when pad sets are added', async () => {
    const padSets = await setUp()
    padSets.list = []
    window.dispatchEvent(new PadSetListUpdatedEvent())
    await settle()
    expect(padSets.list.map(set => set.id)).to.include('builtin')
  })

  it('stops listening when its host disconnects', async () => {
    const padSets = await setUp()
    const before = padSets.activeId
    host.remove()
    window.dispatchEvent(new PadSetChangedEvent({ id: 'drive-other', name: 'Other' }))
    expect(padSets.activeId).to.equal(before)
  })
})

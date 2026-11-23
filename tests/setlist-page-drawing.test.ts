/**
 * What drawing a setlist costs, as the setlist page reports it (docs/OBSERVABILITY.md): the first
 * paint, every song painted, and how much there is in the page.
 */
import { expect } from '@open-wc/testing'
import { setTelemetryPreference } from '../src/js/preferences.ts'
import { useSetlistPage } from './setlist-page-harness.ts'

const { describe, it, afterEach } = window

describe('the setlist page: timing its drawing', () => {
  const rig = useSetlistPage()

  afterEach(() => {
    setTelemetryPreference(true)
  })

  it('says when it first painted and when every song was, and how many elements there are', async () => {
    setTelemetryPreference(true)
    await rig.saveSong('One')
    await rig.saveSong('Two')
    await rig.open(2)
    const drawn = await rig.page._timeDrawing()
    expect(drawn.firstPaintMs).to.be.a('number')
    expect(drawn.settledMs as number).to.be.at.least(drawn.firstPaintMs as number)
    // (more than the songs' own elements: what is in their shadow roots is counted)
    expect(drawn.domElements as number).to.be.greaterThan(rig.root.getElementsByTagName('*').length)
  })

  it('measures nothing while reports are off', async () => {
    await rig.saveSong('One')
    await rig.open(1)
    setTelemetryPreference(false)
    expect(await rig.page._timeDrawing()).to.deep.equal({})
  })

  it('leaves out the times of a page that got no frame, as a hidden one does not', async () => {
    setTelemetryPreference(true)
    await rig.saveSong('One')
    await rig.open(1)
    const real = window.requestAnimationFrame
    window.requestAnimationFrame = (() => 1) as typeof window.requestAnimationFrame
    try {
      const drawn = await rig.page._timeDrawing(10)
      expect(drawn).to.not.have.property('firstPaintMs')
      expect(drawn).to.not.have.property('settledMs')
      expect(drawn.domElements).to.be.greaterThan(0)
    } finally {
      window.requestAnimationFrame = real
    }
  })
})

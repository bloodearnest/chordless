/**
 * The layout check after the screen is turned (src/js/setlist/layout-check.ts): what it reads,
 * what it calls a fault, the row put back on a song, and what it reports.
 */
import { expect } from '@open-wc/testing'
import { trace } from '@opentelemetry/api'
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace'
import { setTelemetryPreference } from '../src/js/preferences.ts'
import {
  type LayoutReading,
  layoutProblems,
  readLayout,
  snapToNearest,
  watchLayout,
} from '../src/js/setlist/layout-check.ts'

const { describe, it, beforeEach, afterEach } = window

const exporter = new InMemorySpanExporter()
let root: HTMLElement
let row: HTMLElement
let abort: AbortController

/** A row of three songs, each as wide as the row, with a square button above it */
function build(sectionWidth = '100%', buttonSize = ['40px', '40px']) {
  root = document.createElement('div')
  root.innerHTML = `
    <button class="share-button" style="display:block;width:${buttonSize[0]};height:${buttonSize[1]};padding:0"></button>
    <div class="song-container" style="display:flex;overflow-x:auto;width:300px;height:100px;scroll-behavior:auto">
      <div class="section" style="flex:none;width:${sectionWidth}"></div>
      <div class="section" style="flex:none;width:${sectionWidth}"></div>
      <div class="section" style="flex:none;width:${sectionWidth}"></div>
    </div>`
  document.body.append(root)
  row = root.querySelector('.song-container') as HTMLElement
}

const reading = (overrides: Partial<LayoutReading> = {}): LayoutReading => ({
  innerWidth: 1024,
  clientWidth: 1024,
  visualWidth: 1024,
  containerWidth: 1024,
  sectionWidth: 1024,
  snapOffset: 0,
  buttonStretch: 0,
  ...overrides,
})

const reports = () =>
  exporter.getFinishedSpans().filter(span => span.name === 'chordless.layout.check')
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

beforeEach(() => {
  trace.disable()
  exporter.reset()
  trace.setGlobalTracerProvider(
    new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] })
  )
  setTelemetryPreference(true)
  abort = new AbortController()
})

afterEach(() => {
  abort.abort()
  root?.remove()
  trace.disable()
})

describe('layoutProblems', () => {
  it('finds nothing wrong with a layout that agrees', () => {
    expect(layoutProblems(reading())).to.deep.equal([])
    // (a fraction of a pixel is layout's rounding)
    expect(layoutProblems(reading({ sectionWidth: 1024.4, snapOffset: 0.5 }))).to.deep.equal([])
  })

  it('names each thing that does not agree', () => {
    expect(layoutProblems(reading({ clientWidth: 1366 }))).to.deep.equal(['viewport'])
    expect(layoutProblems(reading({ visualWidth: 1366 }))).to.deep.equal(['visual_viewport'])
    expect(layoutProblems(reading({ sectionWidth: 1366 }))).to.deep.equal(['section_width'])
    expect(layoutProblems(reading({ snapOffset: 512 }))).to.deep.equal(['off_snap'])
    expect(layoutProblems(reading({ buttonStretch: 0.3 }))).to.deep.equal(['button_shape'])
  })

  it('does not mind a browser with no visual viewport', () => {
    expect(layoutProblems(reading({ visualWidth: null }))).to.deep.equal([])
  })
})

describe('readLayout', () => {
  it('reads the row, the songs and the buttons', () => {
    build()
    const read = readLayout(root, row)
    expect(read?.containerWidth).to.equal(300)
    expect(read?.sectionWidth).to.equal(300)
    expect(read?.snapOffset).to.equal(0)
    expect(read?.buttonStretch).to.equal(0)
  })

  it('sees songs wider than the row, a row stopped between two, and a stretched button', () => {
    build('450px', ['52px', '40px'])
    row.scrollLeft = 200
    const read = readLayout(root, row)
    expect(read?.sectionWidth).to.equal(450)
    expect(read?.snapOffset).to.equal(200)
    expect(read?.buttonStretch).to.be.closeTo(0.3, 0.001)
    expect(layoutProblems(read as LayoutReading)).to.have.members([
      'section_width',
      'off_snap',
      'button_shape',
    ])
  })

  it('reads the buttons in the header’s shadow root too, and a browser with no visual viewport', () => {
    build()
    const header = document.createElement('app-header')
    header.attachShadow({ mode: 'open' }).innerHTML =
      '<button class="icon-button" style="display:block;width:60px;height:40px;padding:0"></button>'
    root.prepend(header)
    expect(readLayout(root, row)?.buttonStretch).to.be.closeTo(0.5, 0.001)
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: null })
    try {
      expect(readLayout(root, row)?.visualWidth).to.equal(null)
    } finally {
      delete (window as { visualViewport?: unknown }).visualViewport
    }
  })

  it('leaves out a button that is not shown, and says nothing before the songs are there', () => {
    build()
    ;(root.querySelector('.share-button') as HTMLElement).style.display = 'none'
    expect(readLayout(root, row)?.buttonStretch).to.equal(0)
    row.textContent = ''
    expect(readLayout(root, row)).to.equal(null)
  })
})

describe('snapToNearest', () => {
  it('puts a row stopped between two songs on the nearer one', () => {
    build()
    row.scrollLeft = 120
    expect(snapToNearest(row)).to.equal(true)
    expect(row.scrollLeft).to.equal(0)
    row.scrollLeft = 200
    expect(snapToNearest(row)).to.equal(true)
    expect(row.scrollLeft).to.equal(300)
  })

  it('leaves a row that is on a song, or has none', () => {
    build()
    row.scrollLeft = 300
    expect(snapToNearest(row)).to.equal(false)
    row.textContent = ''
    expect(snapToNearest(row)).to.equal(false)
  })
})

describe('watchLayout', () => {
  const watch = () =>
    watchLayout({ root, container: () => row, signal: abort.signal, delays: [10, 40] })

  it('reports twice after a resize that settles, and says all was well', async () => {
    build()
    watch()
    window.dispatchEvent(new Event('resize'))
    await wait(120)
    const [settled, late] = reports()
    expect(settled.attributes).to.include({
      'chordless.layout.phase': 'settled',
      'chordless.layout.ok': true,
      'chordless.layout.problems': '',
      'chordless.layout.healed': false,
      'chordless.layout.container_width': 300,
    })
    expect(late.attributes['chordless.layout.phase']).to.equal('late')
  })

  it('counts a burst of resizes as one, from the last', async () => {
    build()
    watch()
    for (let i = 0; i < 4; i++) window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('orientationchange'))
    await wait(120)
    expect(reports()).to.have.length(2)
  })

  it('puts a row stopped between two songs back on one, and says it did', async () => {
    build()
    row.scrollLeft = 120
    await wait(350) // (the scroll is over)
    watch()
    window.dispatchEvent(new Event('resize'))
    await wait(25)
    const [settled] = reports()
    expect(settled.attributes).to.include({
      'chordless.layout.ok': false,
      'chordless.layout.problems': 'off_snap',
      'chordless.layout.healed': true,
      'chordless.layout.still': '',
    })
    expect(row.scrollLeft).to.equal(0)
  })

  it('does not move a row that is being scrolled, and says what is still wrong when it cannot mend it', async () => {
    build('450px', ['52px', '40px'])
    watch()
    row.scrollLeft = 200 // (a scroll: the row is moving)
    window.dispatchEvent(new Event('resize'))
    await wait(25)
    const [settled] = reports()
    expect(settled.attributes['chordless.layout.healed']).to.equal(false)
    expect(settled.attributes['chordless.layout.moving']).to.equal(true)
    // (a row still moving is not called stopped between two songs)
    expect(String(settled.attributes['chordless.layout.problems'])).to.not.include('off_snap')
    expect(String(settled.attributes['chordless.layout.still'])).to.include('section_width')
    expect(String(settled.attributes['chordless.layout.still'])).to.include('button_shape')
    expect(row.scrollLeft).to.equal(200)
  })

  it('says nothing once stopped, and before the songs are there', async () => {
    build()
    watch()
    abort.abort()
    window.dispatchEvent(new Event('resize'))
    await wait(60)
    expect(reports()).to.have.length(0)

    abort = new AbortController()
    row.textContent = ''
    watch()
    window.dispatchEvent(new Event('resize'))
    await wait(60)
    expect(reports()).to.have.length(0)
  })

  it('reports at most a dozen times in a page load', async () => {
    build()
    watch()
    for (let i = 0; i < 8; i++) {
      window.dispatchEvent(new Event('resize'))
      await wait(55)
    }
    expect(reports()).to.have.length(12)
  })
})

/** The speed test (docs/SPEED_TEST.md): the songs it draws, what it measures, and the report it makes */
import { expect } from '@open-wc/testing'
import { syntheticChart, syntheticSetlist } from '../src/js/speed-test/chart.ts'
import {
  countTree,
  scrollDown,
  settle,
  summariseFrames,
  timeDrawing,
} from '../src/js/speed-test/measure.ts'
import { speedTestReport } from '../src/js/speed-test/report.ts'
import { type Progress, type RunResult, runSpeedTest } from '../src/js/speed-test/runner.ts'
import { VARIANTS } from '../src/js/speed-test/variants.ts'
import type { DeviceDetails } from '../src/js/telemetry/device.ts'

const { describe, it, afterEach } = window

/** Somewhere to draw, on the screen and scrolling, as the page has */
function makeStage(): HTMLElement {
  const stage = document.createElement('div')
  stage.style.cssText = 'height: 300px; overflow-y: auto; width: 600px'
  document.body.append(stage)
  return stage
}

const stages: HTMLElement[] = []
function stage(): HTMLElement {
  const made = makeStage()
  stages.push(made)
  return made
}
afterEach(() => {
  for (const made of stages.splice(0)) made.remove()
})

describe('the songs the speed test draws', () => {
  it('are the same each time, and each is its own', () => {
    expect(syntheticChart(3, { chords: true })).to.deep.equal(syntheticChart(3, { chords: true }))
    expect(syntheticChart(3, { chords: true })).to.not.deep.equal(
      syntheticChart(4, { chords: true })
    )
  })

  it('are the size of a chart: four sections of six lines, a chord over every other word', () => {
    const chart = syntheticChart(0, { chords: true })
    expect(chart.sections.map(section => section.label)).to.deep.equal([
      'Verse 1',
      'Chorus',
      'Verse 2',
      'Bridge',
    ])
    for (const section of chart.sections) {
      expect(section.lines).to.have.length(6)
      for (const line of section.lines) {
        expect(line.segments).to.have.length(8)
        expect(line.segments.map(segment => segment.chord !== '')).to.deep.equal([
          true,
          false,
          true,
          false,
          true,
          false,
          true,
          false,
        ])
      }
    }
  })

  it('have no chords when asked, and the same words', () => {
    const plain = syntheticChart(2, { chords: false })
    const chorded = syntheticChart(2, { chords: true })
    const words = (chart: typeof plain) =>
      chart.sections.flatMap(section =>
        section.lines.flatMap(line => line.segments.map(segment => segment.lyrics))
      )
    expect(
      plain.sections.flatMap(s => s.lines.flatMap(l => l.segments.map(g => g.chord)))
    ).to.not.include('G')
    expect(words(plain)).to.deep.equal(words(chorded))
  })

  it('make a setlist of the size asked for', () => {
    expect(syntheticSetlist(5, { chords: true })).to.have.length(5)
    expect(syntheticSetlist(0, { chords: true })).to.deep.equal([])
  })
})

describe('summariseFrames', () => {
  it('says nothing of no frames', () => {
    expect(summariseFrames([])).to.deep.equal({
      frames: 0,
      long: 0,
      worstMs: 0,
      medianMs: 0,
      p95Ms: 0,
    })
  })

  it('counts the long frames, as the page’s own report does (50 ms or more), and finds the middle and the tail', () => {
    const gaps = [16, 17, 16, 50, 16, 120, 17, 16, 18, 16]
    const summary = summariseFrames(gaps)
    expect(summary.frames).to.equal(10)
    expect(summary.long).to.equal(2)
    expect(summary.worstMs).to.equal(120)
    expect(summary.medianMs).to.equal(17)
    expect(summary.p95Ms).to.equal(120)
    // (the gaps are not changed: they may be used again)
    expect(gaps[0]).to.equal(16)
  })
})

describe('countTree and settle', () => {
  it('count every element, and every shadow root and component inside the components', async () => {
    const root = stage()
    const [song] = syntheticSetlist(1, { chords: true })
    const variant = VARIANTS[0]
    if (!variant || !song) throw new Error('no variant')
    variant.draw(root, [song])
    await settle(root)
    const count = countTree(root)
    // (a song-display, its four sections, and a chord-display for each of the 96 chords)
    expect(count.components).to.equal(1 + 4 + 96)
    // (the song's and each section's: the chords draw into the section's)
    expect(count.shadowRoots).to.equal(1 + 4)
    expect(count.elements).to.be.greaterThan(count.components)
  })

  it('wait for the sections inside a song, which the song does not', async () => {
    const root = stage()
    const variant = VARIANTS[0]
    if (!variant) throw new Error('no variant')
    variant.draw(root, syntheticSetlist(1, { chords: true }))
    await settle(root)
    const section = root.querySelector('song-display')?.shadowRoot?.querySelector('song-section')
    expect(section?.shadowRoot?.querySelectorAll('.chord-line')).to.have.length(6)
  })

  it('count a page with no components as it is', () => {
    const root = stage()
    root.innerHTML = '<div><span>a</span><span>b</span></div>'
    expect(countTree(root)).to.deep.equal({ elements: 3, shadowRoots: 0, components: 0 })
  })
})

describe('the ways of drawing', () => {
  const charts = (chords: boolean) => syntheticSetlist(2, { chords })

  it('draw the real one as components, a song-display for each song', async () => {
    const root = stage()
    const real = VARIANTS.find(variant => variant.id === 'real')
    real?.draw(root, charts(true))
    await settle(root)
    expect(root.querySelectorAll('song-display')).to.have.length(2)
    expect(countTree(root).components).to.equal(2 * (1 + 4 + 96))
  })

  it('draw the lyrics-only one with the same components and no chords', async () => {
    const root = stage()
    const lyrics = VARIANTS.find(variant => variant.id === 'lyrics')
    expect(lyrics?.chords).to.equal(false)
    lyrics?.draw(root, charts(false))
    await settle(root)
    expect(countTree(root).components).to.equal(2 * (1 + 4))
  })

  it('draw the plain one as ordinary elements: the same words, no component, no shadow root', () => {
    const root = stage()
    const plain = VARIANTS.find(variant => variant.id === 'plain')
    plain?.draw(root, charts(true))
    const count = countTree(root)
    expect(count.components).to.equal(0)
    expect(count.shadowRoots).to.equal(0)
    expect(root.querySelectorAll('.plain-song')).to.have.length(2)
    expect(root.querySelectorAll('.chord-line')).to.have.length(2 * 4 * 6)
    expect(root.querySelector('.lyrics')?.textContent).to.match(/\w+ $/)
  })

  it('are three, each timed in this order', () => {
    expect(VARIANTS.map(variant => variant.id)).to.deep.equal(['real', 'lyrics', 'plain'])
  })
})

describe('timeDrawing', () => {
  it('says how long the drawing took, until it was on the screen and until every component had rendered', async () => {
    const root = stage()
    const real = VARIANTS[0]
    if (!real) throw new Error('no variant')
    const charts = syntheticSetlist(2, { chords: true })
    const times = await timeDrawing(root, () => real.draw(root, charts))
    // (the browser's clock is coarse: a build this small can read as 0)
    expect(times.buildMs).to.be.at.least(0)
    expect(times.firstPaintMs).to.be.a('number')
    expect(times.settledMs).to.be.a('number')
    expect(times.settledMs as number).to.be.at.least(times.firstPaintMs as number)
    expect(root.querySelectorAll('song-display')).to.have.length(2)
  })

  it('says there was no frame where none came, rather than a time', async () => {
    const root = stage()
    // (a page that is hidden makes no frames: a timeout stands in)
    const times = await timeDrawing(root, () => {}, 0)
    expect(times.firstPaintMs).to.equal(null)
    expect(times.settledMs).to.equal(null)
  })
})

describe('scrollDown', () => {
  it('scrolls a page that is long enough, and says how its frames went', async () => {
    const root = stage()
    root.innerHTML = '<div style="height: 6000px"></div>'
    const summary = await scrollDown(root, 200)
    expect(root.scrollTop).to.be.greaterThan(0)
    expect(summary.frames).to.be.greaterThan(2)
    expect(summary.medianMs).to.be.greaterThan(0)
  })

  it('stops at the bottom of a page that is short', async () => {
    const root = stage()
    root.innerHTML = '<div style="height: 320px"></div>'
    const summary = await scrollDown(root, 2000)
    expect(root.scrollTop).to.equal(20)
    expect(summary.frames).to.be.lessThan(40)
  })

  it('does not hang on a page that has nothing to scroll', async () => {
    const root = stage()
    const summary = await scrollDown(root, 2000)
    expect(summary.frames).to.equal(0)
  })
})

describe('runSpeedTest', () => {
  const run = (options: Partial<Parameters<typeof runSpeedTest>[1]> = {}) =>
    runSpeedTest(stage(), {
      signal: new AbortController().signal,
      onProgress: () => {},
      sizes: [1, 2],
      scrollMs: 40,
      ...options,
    })

  it('times each way of drawing at each size, smallest first, and leaves the stage empty', async function () {
    this.timeout(20000)
    const root = stage()
    const seen: Progress[] = []
    const outcome = await runSpeedTest(root, {
      signal: new AbortController().signal,
      onProgress: progress => seen.push(progress),
      sizes: [1, 2],
      scrollMs: 40,
    })
    expect(outcome.results.map(result => [result.songs, result.variant])).to.deep.equal([
      [1, 'real'],
      [1, 'lyrics'],
      [1, 'plain'],
      [2, 'real'],
      [2, 'lyrics'],
      [2, 'plain'],
    ])
    expect(seen.map(progress => [progress.done, progress.total])).to.deep.equal(
      [0, 1, 2, 3, 4, 5].map(done => [done, 6])
    )
    expect(outcome.stopped).to.equal(false)
    expect(outcome.hidden).to.equal(false)
    expect(outcome.durationMs).to.be.greaterThan(0)
    expect(root.children).to.have.length(0)
    const [first] = outcome.results
    expect(first?.components).to.equal(1 + 4 + 96)
    expect(first?.scroll.frames).to.be.a('number')
  })

  it('shows the cost of the chords: more components for the same words', async function () {
    this.timeout(20000)
    const { results } = await run({ sizes: [2] })
    const by = (id: string) => results.find(result => result.variant === id) as RunResult
    expect(by('real').components).to.be.greaterThan(by('lyrics').components)
    expect(by('plain').components).to.equal(0)
    expect(by('plain').shadowRoots).to.equal(0)
  })

  it('stops when told to, after the timing under way, and says so', async function () {
    this.timeout(20000)
    const controller = new AbortController()
    let told = 0
    const outcome = await run({
      signal: controller.signal,
      // (told as the second is about to start: the first is finished, and the second is not drawn)
      onProgress: () => {
        if (++told === 2) controller.abort()
      },
    })
    expect(outcome.stopped).to.equal(true)
    expect(outcome.results).to.have.length(1)
    expect(outcome.results[0]?.variant).to.equal('real')
  })

  it('draws nothing more when told to stop while it waits to begin one', async function () {
    this.timeout(20000)
    const controller = new AbortController()
    const outcome = await run({
      signal: controller.signal,
      onProgress: () => controller.abort(),
    })
    expect(outcome.stopped).to.equal(true)
    expect(outcome.results).to.have.length(0)
  })

  it('says if the page was hidden while it ran', async function () {
    this.timeout(20000)
    const hide = () => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      document.dispatchEvent(new Event('visibilitychange'))
    }
    try {
      const outcome = await run({ sizes: [1], onProgress: hide })
      expect(outcome.hidden).to.equal(true)
    } finally {
      Reflect.deleteProperty(document, 'hidden')
    }
  })
})

describe('speedTestReport', () => {
  const device: DeviceDetails = {
    deviceClass: 'tablet',
    touchPoints: 5,
    touch: true,
    browserName: 'Safari',
    browserVersion: '17',
    osName: 'iPadOS',
    pointer: 'coarse',
    hover: false,
    screen: '1024x1366',
    viewport: '1000x1350',
    pixelRatio: 2,
    displayMode: 'standalone',
  }
  const info = {
    supportId: '6144007e',
    version: '7d3c35fbfb62',
    device,
    online: true,
    userAgent: 'Mozilla/5.0 (Macintosh)',
  }
  const facts = { cores: 6, reducedMotion: false, serviceWorker: true }
  const when = new Date('2026-11-27T21:30:00Z')
  const result = (overrides: Partial<RunResult> = {}): RunResult => ({
    variant: 'real',
    songs: 16,
    buildMs: 120.4,
    firstPaintMs: 3564.2,
    settledMs: 3772.9,
    elements: 8120,
    shadowRoots: 65,
    components: 1585,
    scroll: { frames: 150, long: 12, worstMs: 210, medianMs: 16.7, p95Ms: 83.3 },
    ...overrides,
  })
  const outcome = (results: RunResult[], overrides = {}) => ({
    results,
    stopped: false,
    hidden: false,
    durationMs: 48_400,
    ...overrides,
  })

  it('starts with what Contact gives, so that it is found as any message is', () => {
    const report = speedTestReport({
      info,
      facts,
      lowPower: 'unknown',
      outcome: outcome([result()]),
      note: '',
      when,
    })
    const lines = report.split('\n')
    expect(lines[0]).to.equal('Chordless speed test (report version 1)')
    expect(report).to.contain('Support ID: 6144007e')
    expect(report).to.contain('Version: 7d3c35fbfb62')
    expect(report).to.contain('Device: tablet, coarse pointer, 5 touch points')
    expect(report).to.contain('Cores: 6, reduced motion: off, service worker: yes')
    expect(report).to.contain('Low Power Mode: not said')
    expect(report).to.contain('Run: 2026-11-27T21:30:00.000Z, taking 48 s')
  })

  it('says what the person said of Low Power Mode', () => {
    const say = (lowPower: 'on' | 'off' | 'unknown') =>
      speedTestReport({ info, facts, lowPower, outcome: outcome([]), note: '', when })
    expect(say('on')).to.contain('Low Power Mode: on')
    expect(say('off')).to.contain('Low Power Mode: off')
    expect(say('unknown')).to.contain('Low Power Mode: not said')
  })

  it('gives each timing on a line of its own, under the way of drawing it', () => {
    const report = speedTestReport({
      info,
      facts,
      lowPower: 'unknown',
      outcome: outcome([result(), result({ variant: 'plain', components: 0, shadowRoots: 0 })]),
      note: '',
      when,
    })
    expect(report).to.contain('Real: as Chordless draws a setlist, with chords:')
    expect(report).to.contain('Plain: the same words and chords as ordinary elements')
    // (a way that was not reached is not mentioned)
    expect(report).to.not.contain('Lyrics:')
    expect(report).to.contain(
      '16 songs: first painted after 3564 ms, all drawn after 3773 ms (building them took 120 ms). The page had 8120 elements, 65 shadow roots and 1585 components. Scrolling: 12 of 150 frames long (8%), worst 210 ms, median 17 ms, 95th 83 ms.'
    )
  })

  it('carries what the person said, and says when it stopped early or the page was hidden', () => {
    const report = speedTestReport({
      info,
      facts,
      lowPower: 'unknown',
      outcome: outcome([result()], { stopped: true, hidden: true }),
      note: '  Low Power Mode is on ',
      when,
    })
    expect(report).to.contain('\nNote: Low Power Mode is on\n')
    expect(report).to.contain('Stopped before the end')
    expect(report).to.contain('The page was hidden while it ran')
  })

  it('says a scroll with no frames was 0%, not not-a-number, and that reduced motion was on', () => {
    const report = speedTestReport({
      info,
      facts: { ...facts, reducedMotion: true },
      lowPower: 'unknown',
      outcome: outcome([
        result({ scroll: { frames: 0, long: 0, worstMs: 0, medianMs: 0, p95Ms: 0 } }),
      ]),
      note: '',
      when,
    })
    expect(report).to.contain('Scrolling: 0 of 0 frames long (0%)')
    expect(report).to.contain('reduced motion: on')
    expect(report).to.not.contain('NaN')
  })

  it('says a frame did not come, not a time', () => {
    const report = speedTestReport({
      info,
      facts,
      lowPower: 'unknown',
      outcome: outcome([result({ firstPaintMs: null, settledMs: null })]),
      note: '',
      when,
    })
    expect(report).to.contain(
      'first painted after none (page hidden), all drawn after none (page hidden)'
    )
  })

  it('has no Note line when nothing was said, and says when cores are not known', () => {
    const report = speedTestReport({
      info,
      facts: { ...facts, cores: 0, serviceWorker: false },
      lowPower: 'unknown',
      outcome: outcome([]),
      note: '   ',
      when,
    })
    expect(report).to.not.contain('Note:')
    expect(report).to.contain('Cores: not said')
    expect(report).to.contain('service worker: no')
  })

  it('does not hold a song, a title or a lyric of anyone’s: only the made-up ones are timed', () => {
    const report = speedTestReport({
      info,
      facts,
      lowPower: 'unknown',
      outcome: outcome([result()]),
      note: '',
      when,
    })
    expect(report).to.not.match(/Test song|holy|lord/i)
  })
})

describe('scrollDown on a page that gets no frames', () => {
  it('ends with the frames it had, rather than waiting for ever', async () => {
    const root = stage()
    root.innerHTML = '<div style="height: 6000px"></div>'
    const real = window.requestAnimationFrame
    const waiting: FrameRequestCallback[] = []
    // (a hidden page: the browser makes no frames, and a callback asked for is never called)
    window.requestAnimationFrame = callback => waiting.push(callback)
    try {
      const summary = await scrollDown(root, 10, 20)
      expect(summary.frames).to.equal(0)
      // (and a frame that does come after it has ended changes nothing: the page is not scrolled on)
      const top = root.scrollTop
      for (const callback of waiting) callback(performance.now() + 5000)
      expect(root.scrollTop).to.equal(top)
    } finally {
      window.requestAnimationFrame = real
    }
  })
})

describe('the plain way of drawing a section with no label', () => {
  it('draws its title empty, and its lines', () => {
    const root = stage()
    const plain = VARIANTS.find(variant => variant.id === 'plain')
    const [chart] = syntheticSetlist(1, { chords: true })
    if (!chart?.sections[0]) throw new Error('no chart')
    plain?.draw(root, [{ ...chart, sections: [{ ...chart.sections[0], label: null }] }])
    expect(root.querySelector('.section-title')?.textContent).to.equal('')
    expect(root.querySelectorAll('.chord-line')).to.have.length(6)
  })
})

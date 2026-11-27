import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import { trace } from '@opentelemetry/api'
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace'
import { AppSpeedTest } from '../src/components/app-speed-test.ts'
import { appUpdate } from '../src/js/app-update.ts'
import { setTelemetryPreference } from '../src/js/preferences.ts'
import { suppressConsoleLogs } from './test-helpers.ts'
import '../src/components/app-speed-test.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const exporter = new InMemorySpanExporter()
const sent = () =>
  exporter.getFinishedSpans().filter(span => span.name === 'chordless.speedtest.run')

describe('app-speed-test', () => {
  beforeEach(() => {
    localStorage.clear()
    setTelemetryPreference(true)
    trace.disable()
    exporter.reset()
    trace.setGlobalTracerProvider(
      new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] })
    )
  })

  afterEach(() => {
    trace.disable()
  })

  /** One song at each way of drawing it, scrolled for a moment: the same test, small */
  async function open(): Promise<AppSpeedTest> {
    const element = await fixture<AppSpeedTest>(
      html`<app-speed-test .sizes=${[1]} .scrollMs=${40}></app-speed-test>`
    )
    await element.updateComplete
    return element
  }

  const part = (element: AppSpeedTest, selector: string) =>
    element.shadowRoot?.querySelector<HTMLElement>(selector) ?? null
  const report = (element: AppSpeedTest) => part(element, '#speed-test-report')?.textContent ?? ''

  async function finish(element: AppSpeedTest): Promise<void> {
    part(element, '#speed-test-start')?.click()
    await waitUntil(() => report(element) !== '', 'no report', { timeout: 20000 })
  }

  it('offers to start, says nothing is sent, and has a place for a note', async () => {
    const element = await open()
    expect(part(element, '#speed-test-start')?.textContent).to.contain('Start the test')
    expect(part(element, '#speed-test-private')?.textContent).to.contain(
      "the timings are sent to us with the app's anonymous usage reports"
    )
    expect(part(element, '#speed-test-private a')?.getAttribute('href')).to.equal('/privacy.html')
    expect(part(element, '#speed-test-low-power')).to.not.equal(null)
    expect(part(element, '#speed-test-note')).to.not.equal(null)
    expect(part(element, '.stage')?.hasAttribute('hidden')).to.equal(true)
    expect(report(element)).to.equal('')
  })

  it('times the songs, and shows a report with the Support ID in it', async function () {
    this.timeout(25000)
    const element = await open()
    await finish(element)
    expect(report(element)).to.contain('Chordless speed test')
    expect(report(element)).to.match(/Support ID: [0-9a-f]{8}\n/)
    expect(report(element)).to.contain('1 songs: first painted after')
    // (the theme it was drawn in is said, in the report and in the timings)
    expect(report(element)).to.match(/theme: (light|dark|unknown)\n/)
    expect(sent()[0]?.attributes['chordless.speedtest.theme']).to.match(/^(light|dark|unknown)$/)
    // ...and the test is over: nothing is left drawn, and it offers to run again
    expect(part(element, '.stage')?.children).to.have.length(0)
    expect(part(element, '#speed-test-start')?.textContent).to.contain('Run it again')
  })

  it('shows what is being timed while it runs, and the page it draws on', async function () {
    this.timeout(25000)
    const element = await open()
    part(element, '#speed-test-start')?.click()
    await waitUntil(() => part(element, '#speed-test-progress')?.textContent?.includes('Timing'))
    expect(part(element, '.stage')?.hasAttribute('hidden')).to.equal(false)
    expect(part(element, '#speed-test-stop')).to.not.equal(null)
    await waitUntil(() => report(element) !== '', 'no report', { timeout: 20000 })
  })

  it('sends the timings with the usage reports, and says so', async function () {
    this.timeout(25000)
    const element = await open()
    await finish(element)
    // (one song at each of the three ways)
    expect(sent().map(span => span.attributes['chordless.speedtest.variant'])).to.deep.equal([
      'real',
      'lyrics',
      'plain',
    ])
    expect(new Set(sent().map(span => span.attributes['chordless.speedtest.id'])).size).to.equal(1)
    expect(part(element, '#speed-test-sent')?.textContent).to.contain('were sent to us')
  })

  it('sends nothing while usage reports are off, and says how to send the results instead', async function () {
    this.timeout(25000)
    setTelemetryPreference(false)
    const element = await open()
    expect(part(element, '#speed-test-private')?.textContent).to.contain('Usage reports are off')
    await finish(element)
    expect(sent()).to.have.length(0)
    expect(part(element, '#speed-test-sent')?.textContent).to.contain('nothing was sent')
    // (the report is still there, to copy or email)
    expect(report(element)).to.contain('Chordless speed test')
  })

  it('takes what the person says of Low Power Mode into the report and the timings', async function () {
    this.timeout(25000)
    const element = await open()
    const choice = part(element, '#speed-test-low-power') as HTMLSelectElement
    choice.value = 'on'
    choice.dispatchEvent(new Event('change'))
    await finish(element)
    expect(report(element)).to.contain('Low Power Mode: on')
    expect(sent()[0]?.attributes['chordless.speedtest.low_power']).to.equal('on')
  })

  it('keeps the note out of the timings: it is only in the report', async function () {
    this.timeout(25000)
    const element = await open()
    const box = part(element, '#speed-test-note') as HTMLTextAreaElement
    box.value = 'My sister’s iPad, the one in the hall'
    box.dispatchEvent(new Event('input'))
    await finish(element)
    expect(report(element)).to.contain('My sister’s iPad')
    expect(JSON.stringify(sent().map(span => span.attributes))).to.not.contain('sister')
  })

  it('puts what the person said in the report', async function () {
    this.timeout(25000)
    const element = await open()
    const box = part(element, '#speed-test-note') as HTMLTextAreaElement
    box.value = 'The battery is at 9%'
    box.dispatchEvent(new Event('input'))
    await finish(element)
    expect(report(element)).to.contain('Note: The battery is at 9%')
  })

  it('stops when asked, and gives what it had', async function () {
    this.timeout(25000)
    const element = await open()
    part(element, '#speed-test-start')?.click()
    await waitUntil(() => part(element, '#speed-test-stop'))
    part(element, '#speed-test-stop')?.click()
    await waitUntil(() => report(element) !== '', 'no report', { timeout: 20000 })
    expect(report(element)).to.contain('Stopped before the end')
  })

  it('makes an email of the report, and copies it', async function () {
    this.timeout(25000)
    AppSpeedTest.copiedMs = 20
    const written: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => written.push(text) },
    })
    try {
      const element = await open()
      await finish(element)
      const link = new URL((part(element, '#speed-test-send') as HTMLAnchorElement).href)
      expect(link.searchParams.get('body')).to.contain(report(element))
      expect(link.searchParams.get('body')).to.contain('Chordless speed test')
      part(element, '#speed-test-copy')?.click()
      await waitUntil(() => written.length === 1)
      expect(written[0]).to.equal(report(element))
      await element.updateComplete
      expect(part(element, '#speed-test-copy')?.textContent).to.contain('Copied')
    } finally {
      AppSpeedTest.copiedMs = 2000
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  it('is still usable when the browser will not copy', async function () {
    this.timeout(25000)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('denied')
        },
      },
    })
    try {
      const element = await open()
      await finish(element)
      part(element, '#speed-test-copy')?.click()
      await element.updateComplete
      expect(part(element, '#speed-test-copy')?.textContent).to.contain('Copy the results')
      expect(report(element)).to.not.equal('')
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  it('says so, and offers to start again, when the test cannot run', async () => {
    const element = await open()
    // (a setlist size the app would never give)
    element.sizes = null as unknown as number[]
    part(element, '#speed-test-start')?.click()
    await waitUntil(() => part(element, '#speed-test-failed'))
    expect(part(element, '#speed-test-failed')?.textContent).to.contain('could not finish')
    // (and the failure is reported, as the app's other errors are)
    expect(sent()[0]?.attributes).to.include({ 'chordless.speedtest.outcome': 'error' })
    expect(part(element, '#speed-test-start')).to.not.equal(null)
  })

  it('gives the version that is running in the report, and says it is unknown when the worker cannot say', async function () {
    this.timeout(60000)
    const real = appUpdate.runningVersion
    try {
      appUpdate.runningVersion = async () => ({ version: 'abc123', released: '' })
      const known = await open()
      await waitUntil(() => known._version === 'abc123')
      await finish(known)
      expect(report(known)).to.contain('Version: abc123')

      // (a worker with nothing to say, and one that fails)
      appUpdate.runningVersion = async () => null
      const none = await open()
      await new Promise(resolve => setTimeout(resolve, 0))
      await finish(none)
      expect(report(none)).to.contain('Version: unknown')

      appUpdate.runningVersion = async () => {
        throw new Error('no worker')
      }
      const failing = await open()
      await new Promise(resolve => setTimeout(resolve, 0))
      await finish(failing)
      expect(report(failing)).to.contain('Version: unknown')
    } finally {
      appUpdate.runningVersion = real
    }
  })

  it('does not start a second test while one is running', async function () {
    this.timeout(25000)
    const element = await open()
    const first = element._start()
    await waitUntil(() => element._state === 'running')
    await element._start()
    await first
    // (one song at each of the three ways, once)
    expect(sent()).to.have.length(3)
  })

  it('says what went wrong when it was not an error that was thrown', async () => {
    const element = await open()
    Object.defineProperty(element, 'sizes', {
      configurable: true,
      get() {
        throw 'plain words'
      },
    })
    part(element, '#speed-test-start')?.click()
    await waitUntil(() => part(element, '#speed-test-failed'))
    expect(part(element, '#speed-test-failed')?.textContent).to.contain('plain words')
  })

  it('ends the test when the page is left', async function () {
    this.timeout(25000)
    const element = await open()
    part(element, '#speed-test-start')?.click()
    await waitUntil(() => part(element, '#speed-test-stop'))
    element.remove()
    // (the test ends, as stopped, and nothing is left on the page it was drawn on)
    await waitUntil(() => element._state === 'done', 'it did not end', { timeout: 10000 })
    expect(element._report).to.contain('Stopped before the end')
    expect(part(element, '.stage')?.children).to.have.length(0)
  })
})

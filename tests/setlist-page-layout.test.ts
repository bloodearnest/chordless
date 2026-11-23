/**
 * The setlist page checks its layout after the screen is turned (src/js/setlist/layout-check.ts)
 */
import { expect, waitUntil } from '@open-wc/testing'
import { trace } from '@opentelemetry/api'
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace'
import { setTelemetryPreference } from '../src/js/preferences.ts'
import { useSetlistPage } from './setlist-page-harness.ts'

const { describe, it, afterEach } = window

const exporter = new InMemorySpanExporter()

describe('the setlist page: layout check', () => {
  const rig = useSetlistPage()

  afterEach(() => {
    trace.disable()
  })

  it('reports on its layout once the window has been resized and has settled', async () => {
    trace.disable()
    exporter.reset()
    trace.setGlobalTracerProvider(
      new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] })
    )
    setTelemetryPreference(true)
    await rig.saveSong('One')
    await rig.open(1)
    window.dispatchEvent(new Event('resize'))
    await waitUntil(
      () => exporter.getFinishedSpans().some(span => span.name === 'chordless.layout.check'),
      'a layout check',
      { timeout: 3000 }
    )
    const [check] = exporter
      .getFinishedSpans()
      .filter(span => span.name === 'chordless.layout.check')
    expect(check.attributes['chordless.layout.phase']).to.equal('settled')
    expect(check.attributes['chordless.layout.section_width']).to.be.greaterThan(0)
  })
})

/**
 * A setlist session (src/js/telemetry/setlist-session.ts, docs/OBSERVABILITY.md): its id on every
 * span while it lasts, an open span and a leave span that says what happened between, and the song
 * in view on every span.
 */
import { expect } from '@open-wc/testing'
import { trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-web'
import { goLive } from '../src/js/live.ts'
import { setTelemetryPreference } from '../src/js/preferences.ts'
import { baselineAttributes } from '../src/js/telemetry/baseline.ts'
import { setAmbient } from '../src/js/telemetry/context.ts'
import {
  editModeEntered,
  endSetlistSession,
  type SetlistOpened,
  type SongInView,
  songShown,
  songTransposed,
  startSetlistSession,
} from '../src/js/telemetry/setlist-session.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const exporter = new InMemorySpanExporter()

beforeEach(() => {
  localStorage.clear()
  trace.disable()
  exporter.reset()
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
  )
  endSetlistSession()
  setAmbient({ sessionId: undefined })
  exporter.reset()
})

afterEach(() => {
  endSetlistSession()
  setAmbient({ sessionId: undefined })
  trace.disable()
  localStorage.clear()
})

const opened = (overrides: Partial<SetlistOpened> = {}): SetlistOpened => ({
  setlistId: 'setlist-1',
  date: '2026-11-01',
  songs: 3,
  ccli: ['22025', '7062207'],
  source: 'library',
  openMs: 123.4,
  hasUnsent: () => false,
  ...overrides,
})

const song = (index: number): SongInView => ({ songId: `song-${index}`, index })

const spans = () => exporter.getFinishedSpans()
const named = (name: string) => spans().filter(span => span.name === name)

describe('opening a setlist', () => {
  it('makes an open span with what the setlist is, and its own session id on every span after', () => {
    startSetlistSession(opened())
    const [span] = named('chordless.setlist.open')
    expect(span.attributes).to.include({
      'chordless.setlist.id': 'setlist-1',
      'chordless.setlist.date': '2026-11-01',
      'chordless.setlist.songs': 3,
      'chordless.setlist.ccli': '22025,7062207',
      'chordless.setlist.source': 'library',
      'chordless.setlist.open_ms': 123,
    })
    // (the session is on every span after, the setlist is not: a background sync is not about it)
    const attributes = baselineAttributes()
    expect(attributes['session.id']).to.match(/^[0-9a-f-]{36}$/)
    expect(attributes).to.not.have.property('chordless.setlist.id')
  })

  it('is a new session each time, and says so of one received by link', () => {
    startSetlistSession(opened({ source: 'share' }))
    const first = baselineAttributes()['session.id']
    expect(named('chordless.setlist.open')[0].attributes['chordless.setlist.source']).to.equal(
      'share'
    )
    startSetlistSession(opened())
    expect(baselineAttributes()['session.id']).to.not.equal(first)
    // (the first was left, as the second began)
    expect(named('chordless.setlist.leave')).to.have.length(1)
  })

  it('keeps one session across a reload while live, so a service is one session', () => {
    goLive('/setlist/setlist-1', 'Sunday', 1_790_000_000_000)
    startSetlistSession(opened())
    const first = String(baselineAttributes()['session.id'])
    expect(first).to.match(/-live-1790000000000$/)
    endSetlistSession()
    startSetlistSession(opened())
    expect(baselineAttributes()['session.id']).to.equal(first)
  })

  it('does nothing while reports are off', () => {
    setTelemetryPreference(false)
    startSetlistSession(opened())
    songShown(song(0))
    endSetlistSession()
    expect(spans()).to.have.length(0)
    expect(baselineAttributes()).to.not.have.property('session.id')
  })
})

describe('the song in view', () => {
  it('is on no span: only counted, for the setlist’s leave span', () => {
    startSetlistSession(opened())
    songShown(song(1))
    const attributes = baselineAttributes()
    expect(attributes).to.not.have.property('chordless.song.id')
    expect(attributes).to.not.have.property('chordless.song.key')
  })

  it('is not told of before there is a session, or after it', () => {
    songShown(song(0))
    songTransposed()
    editModeEntered()
    startSetlistSession(opened())
    songShown(song(0))
    endSetlistSession()
    expect(baselineAttributes()).to.not.have.property('session.id')
    // (nothing was counted into a session that was not there)
    const [leave] = named('chordless.setlist.leave')
    expect(leave.attributes['chordless.setlist.songs_viewed']).to.equal(1)
    expect(leave.attributes['chordless.setlist.transposes']).to.equal(0)
    expect(leave.attributes['chordless.setlist.edit_entries']).to.equal(0)
  })
})

describe('leaving a setlist', () => {
  it('says what happened: songs seen, changes, transposes and edit mode', () => {
    startSetlistSession(opened())
    songShown(song(0))
    songShown(song(0)) // (shown again, as a re-render does: not a change)
    songShown(song(1))
    songShown(null)
    songShown(song(1))
    songShown(song(2))
    songTransposed()
    songTransposed()
    editModeEntered()
    endSetlistSession()
    const [leave] = named('chordless.setlist.leave')
    expect(leave.attributes).to.include({
      'chordless.setlist.songs_viewed': 3,
      'chordless.setlist.song_changes': 4,
      'chordless.setlist.transposes': 2,
      'chordless.setlist.edit_entries': 1,
    })
    expect(leave.attributes['chordless.setlist.session_ms']).to.be.a('number')
    // (the setlist is named on the leave span, which is about it)
    expect(leave.attributes).to.include({
      'chordless.setlist.id': 'setlist-1',
      'chordless.setlist.date': '2026-11-01',
    })
  })

  it('happens when the page is closed, once', () => {
    startSetlistSession(opened())
    window.dispatchEvent(new Event('pagehide'))
    window.dispatchEvent(new Event('pagehide'))
    endSetlistSession()
    expect(named('chordless.setlist.leave')).to.have.length(1)
  })

  it('is nothing when no setlist was opened', () => {
    endSetlistSession()
    expect(spans()).to.have.length(0)
  })
})

describe('changes not yet sent, when a setlist is left', () => {
  it('says there were none, and that the app carried on, when it moved to another page', () => {
    startSetlistSession(opened())
    endSetlistSession()
    const [leave] = named('chordless.setlist.leave')
    expect(leave.attributes).to.include({
      'chordless.setlist.unsent_on_leave': false,
      'chordless.setlist.left': 'navigation',
    })
  })

  it('says there were some, as they are when the page is closed', () => {
    let unsent = false
    startSetlistSession(opened({ hasUnsent: () => unsent }))
    unsent = true
    window.dispatchEvent(new Event('pagehide'))
    const [leave] = named('chordless.setlist.leave')
    expect(leave.attributes).to.include({
      'chordless.setlist.unsent_on_leave': true,
      'chordless.setlist.left': 'page',
    })
  })

  it('asks when the setlist is left, not before', () => {
    let asked = 0
    startSetlistSession(
      opened({
        hasUnsent: () => {
          asked++
          return false
        },
      })
    )
    songShown(song(0))
    expect(asked).to.equal(0)
    endSetlistSession()
    expect(asked).to.equal(1)
  })
})

import { expect } from '@open-wc/testing'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

import * as preferencesModule from '../src/js/preferences.ts'

type Preferences = typeof preferencesModule

const KEYS = [
  'use-nashville',
  'use-unicode-accidentals',
  'musician_type',
  'section_defaults',
  'enable_capo',
  'enabled_capo',
  'setup-done',
  'keep_screen_awake',
  'scroll_to_top_on_swipe',
  'keep_awake_minutes',
  'show_shared_annotations',
  'show_my_annotations',
  'chord_tint',
  'font_ui',
  'font_lyrics',
  'font_chords',
]

const fresh = (): Promise<Preferences> => Promise.resolve(preferencesModule)

/** What a call sends on window, as `type` events */
function heard<T extends Event>(type: string, call: () => void): T[] {
  const events: T[] = []
  const listener = (event: Event) => events.push(event as T)
  window.addEventListener(type, listener)
  try {
    call()
  } finally {
    window.removeEventListener(type, listener)
  }
  return events
}

describe('preferences', () => {
  beforeEach(() => {
    for (const key of KEYS) localStorage.removeItem(key)
  })

  // What is stored is read once, the first time it is asked for: so this is the first test
  it('reads what is stored when first asked', async () => {
    localStorage.setItem('use-nashville', 'true')
    localStorage.setItem('use-unicode-accidentals', '1')
    localStorage.setItem('musician_type', 'drummer')
    localStorage.setItem('enabled_capo', '1')
    const preferences = await fresh()
    expect(preferences.getUseNashvilleNumbers()).to.equal(true)
    expect(preferences.getUseUnicodeAccidentals()).to.equal(true)
    // (the switches are what count: a stored type that they do not agree with is the type they make)
    expect(preferences.getMusicianType()).to.equal('guitarist')
    expect(preferences.getCapoPreference()).to.equal(true)
  })
  afterEach(() => {
    for (const key of KEYS) localStorage.removeItem(key)
  })

  describe('annotations on a chart', () => {
    it('are shown unless turned off, each kind on its own, and said on window', async () => {
      const preferences = await fresh()
      expect(preferences.getAnnotationsPreference()).to.deep.equal({ shared: true, mine: true })
      const heardOf = heard<InstanceType<Preferences['AnnotationsPreferenceEvent']>>(
        'preferences:annotations-changed',
        () => {
          preferences.setAnnotationsPreference('shared', false)
          preferences.setAnnotationsPreference('mine', false)
          preferences.setAnnotationsPreference('shared', true)
        }
      )
      expect(heardOf.map(event => [event.shared, event.mine])).to.deep.equal([
        [false, true],
        [false, false],
        [true, false],
      ])
      expect(preferences.getAnnotationsPreference()).to.deep.equal({ shared: true, mine: false })
      expect(localStorage.getItem('show_my_annotations')).to.equal('false')
      preferences.setAnnotationsPreference('mine', true)
      expect(localStorage.getItem('show_my_annotations')).to.equal('true')
    })
  })

  describe('Nashville numbers and accidentals', () => {
    it('are kept, and said on window', async () => {
      const preferences = await fresh()
      const nashville = heard<InstanceType<Preferences['NashvillePreferenceEvent']>>(
        'preferences:nashville-changed',
        () => preferences.setUseNashvilleNumbers(true)
      )
      expect(nashville.map(event => event.enabled)).to.deep.equal([true])
      expect(localStorage.getItem('use-nashville')).to.equal('1')
      expect(preferences.getUseNashvilleNumbers()).to.equal(true)

      const accidentals = heard<InstanceType<Preferences['AccidentalsPreferenceEvent']>>(
        'preferences:accidentals-changed',
        () => preferences.setUseUnicodeAccidentals(true)
      )
      expect(accidentals.map(event => event.enabled)).to.deep.equal([true])
      expect(localStorage.getItem('use-unicode-accidentals')).to.equal('1')
      preferences.setUseUnicodeAccidentals(false)
      preferences.setUseNashvilleNumbers(false)
      expect(localStorage.getItem('use-nashville')).to.equal('0')
      expect(localStorage.getItem('use-unicode-accidentals')).to.equal('0')
    })
  })

  describe('what the person plays', () => {
    it('sets the switches the type stands for, and says so', async () => {
      const preferences = await fresh()
      // [type chosen, what each part shows to start, whether the capo control is on, the type then]
      const expected: [string, string, boolean, string][] = [
        ['general', 'all', false, 'general'],
        ['singer', 'lyrics', false, 'singer'],
        ['guitarist', 'all', true, 'guitarist'],
        ['drummer', 'lyrics', false, 'singer'],
        ['nonsense', 'all', false, 'general'],
      ]
      for (const [type, shown, capo, then] of expected) {
        const events = heard<InstanceType<Preferences['SectionDefaultsEvent']>>(
          'preferences:section-defaults-changed',
          () => preferences.setMusicianType(type)
        )
        expect(events[0].defaults, type).to.deep.equal({ all: shown })
        expect(events.at(-1)?.musicianType, type).to.equal(then)
        expect(JSON.parse(localStorage.getItem('section_defaults') ?? ''), type).to.deep.equal({
          all: shown,
        })
        expect(preferences.getCapoPreference(), type).to.equal(capo)
        expect(preferences.getLyricsOnlyPreference(), type).to.equal(shown === 'lyrics')
        expect(preferences.getMusicianType(), type).to.equal(then)
      }
    })

    it('leaves the switches as they are for Custom, to be set one by one', async () => {
      const preferences = await fresh()
      preferences.setMusicianType('guitarist')
      preferences.setMusicianType('custom')
      expect(preferences.getCapoPreference()).to.equal(true)
      expect(preferences.getMusicianType()).to.equal('custom')
      // (and it stays Custom, though the switches now make a type)
      preferences.setCapoPreference(false)
      expect(preferences.getMusicianType()).to.equal('custom')
      preferences.setLyricsOnlyPreference(true)
      expect(preferences.getLyricsOnlyPreference()).to.equal(true)
      expect(preferences.getMusicianType()).to.equal('custom')
    })

    it('is what the switches make when they were changed since a type was chosen', async () => {
      const preferences = await fresh()
      preferences.setMusicianType('general')
      // (the capo control turned on, as it could be before there was one question)
      preferences.setCapoPreference(true)
      expect(preferences.getMusicianType()).to.equal('guitarist')
      // (a mixture no type makes)
      preferences.setLyricsOnlyPreference(true)
      expect(preferences.getMusicianType()).to.equal('custom')
    })

    it('reads a drummer, as an earlier version stored it, as a singer', async () => {
      const preferences = await fresh()
      localStorage.setItem('musician_type', 'drummer')
      localStorage.setItem('section_defaults', JSON.stringify({ all: 'lyrics' }))
      expect(preferences.getMusicianType()).to.equal('singer')
    })
  })

  describe('the capo', () => {
    it('is read from the older key too', async () => {
      localStorage.setItem('enable_capo', '1')
      expect((await fresh()).getCapoPreference()).to.equal(true)
    })

    it('is kept under both keys, and said on window', async () => {
      const preferences = await fresh()
      const events = heard<InstanceType<Preferences['CapoPreferenceEvent']>>(
        'preferences:capo-changed',
        () => preferences.setCapoPreference(true)
      )
      expect(events.map(event => event.enabled)).to.deep.equal([true])
      expect(localStorage.getItem('enable_capo')).to.equal('true')
      expect(localStorage.getItem('enabled_capo')).to.equal('true')
      expect(preferences.getCapoPreference()).to.equal(true)
      preferences.setCapoPreference(false)
      expect(localStorage.getItem('enable_capo')).to.equal('false')
    })
  })

  describe('the section defaults', () => {
    it('are what the user chose, or everything when nothing is stored', async () => {
      const preferences = await fresh()
      expect(preferences.getSectionDefaults()).to.deep.equal({ all: 'all' })
      localStorage.setItem('section_defaults', JSON.stringify({ all: 'lyrics', chorus: 'hide' }))
      expect(preferences.getSectionDefaults()).to.deep.equal({ all: 'lyrics', chorus: 'hide' })
    })

    it('are everything when what is stored cannot be read', async () => {
      const preferences = await fresh()
      localStorage.setItem('section_defaults', '{not json')
      expect(preferences.getSectionDefaults()).to.deep.equal({ all: 'all' })
      localStorage.setItem('section_defaults', '7')
      expect(preferences.getSectionDefaults()).to.deep.equal({ all: 'all' })
    })
  })

  describe('starting songs at the top', () => {
    it('is on unless turned off', async () => {
      const preferences = await fresh()
      expect(preferences.getScrollToTopOnSwipe()).to.equal(true)
      preferences.setScrollToTopOnSwipe(false)
      expect(localStorage.getItem('scroll_to_top_on_swipe')).to.equal('false')
      expect(preferences.getScrollToTopOnSwipe()).to.equal(false)
      preferences.setScrollToTopOnSwipe(true)
      expect(preferences.getScrollToTopOnSwipe()).to.equal(true)
    })
  })

  describe('keeping the screen awake', () => {
    it('is on unless turned off, and said on window when changed', async () => {
      const preferences = await fresh()
      expect(preferences.getKeepAwakePreference()).to.equal(true)
      const events = heard<InstanceType<Preferences['KeepAwakePreferenceEvent']>>(
        'preferences:keep-awake-changed',
        () => preferences.setKeepAwakePreference(false)
      )
      expect(events.map(event => event.enabled)).to.deep.equal([false])
      expect(preferences.getKeepAwakePreference()).to.equal(false)
    })

    it('has a limit of half an hour until one is chosen, and only takes the ones on offer', async () => {
      const preferences = await fresh()
      expect(preferences.getKeepAwakeMinutes()).to.equal(30)
      const events = heard<InstanceType<Preferences['KeepAwakeLimitEvent']>>(
        'preferences:keep-awake-limit-changed',
        () => {
          preferences.setKeepAwakeMinutes(60)
          preferences.setKeepAwakeMinutes(7)
        }
      )
      expect(events.map(event => event.minutes)).to.deep.equal([60, 30])
      preferences.setKeepAwakeMinutes(120)
      expect(preferences.getKeepAwakeMinutes()).to.equal(120)
      localStorage.setItem('keep_awake_minutes', '7')
      expect(preferences.getKeepAwakeMinutes()).to.equal(30)
    })

    it('turns the limit into milliseconds, or none', async () => {
      const preferences = await fresh()
      expect(preferences.keepAwakeLimitMs(15)).to.equal(15 * 60 * 1000)
      expect(preferences.keepAwakeLimitMs(0)).to.equal(Number.POSITIVE_INFINITY)
      expect(preferences.keepAwakeLimitMs()).to.equal(30 * 60 * 1000)
    })
  })

  describe('where storage is blocked', () => {
    const realGet = Storage.prototype.getItem
    const realSet = Storage.prototype.setItem
    afterEach(() => {
      Storage.prototype.getItem = realGet
      Storage.prototype.setItem = realSet
    })
    const block = () => {
      Storage.prototype.getItem = () => {
        throw new Error('blocked')
      }
      Storage.prototype.setItem = () => {
        throw new Error('blocked')
      }
    }

    it('keeps the awake preferences in memory, and falls back to the defaults', async () => {
      const preferences = await fresh()
      block()
      expect(preferences.getKeepAwakePreference()).to.equal(true)
      expect(preferences.getKeepAwakeMinutes()).to.equal(30)
      expect(() => preferences.setKeepAwakePreference(false)).to.not.throw()
      expect(() => preferences.setKeepAwakeMinutes(30)).to.not.throw()
    })

    it('has no capo when it cannot ask whether it is on', async () => {
      const preferences = await fresh()
      block()
      expect(preferences.getCapoPreference()).to.equal(false)
    })

    it('has everything shown when it cannot ask what the sections show', async () => {
      const preferences = await fresh()
      block()
      expect(preferences.getSectionDefaults()).to.deep.equal({ all: 'all' })
    })

    it('copes with not being able to save the capo', async () => {
      const preferences = await fresh()
      block()
      preferences.setCapoPreference(true)
      expect(preferences.getCapoPreference()).to.equal(true)
      Storage.prototype.getItem = realGet
      Storage.prototype.setItem = realSet
      preferences.setCapoPreference(false)
      expect(preferences.getCapoPreference()).to.equal(false)
    })

    it('says the setup is done, as it cannot ask again, and that no type was chosen', async () => {
      const preferences = await fresh()
      block()
      expect(preferences.isSetupDone()).to.equal(true)
      expect(preferences.hasStoredMusicianType()).to.equal(false)
      expect(() => preferences.markSetupDone()).to.not.throw()
    })
  })

  describe('the first-use setup', () => {
    it('is done once marked, and a chosen musician type is seen', async () => {
      const preferences = await fresh()
      expect(preferences.isSetupDone()).to.equal(false)
      expect(preferences.hasStoredMusicianType()).to.equal(false)
      preferences.markSetupDone()
      preferences.setMusicianType('singer')
      expect(preferences.isSetupDone()).to.equal(true)
      expect(preferences.hasStoredMusicianType()).to.equal(true)
    })
  })
})

describe('the usage reports preference', () => {
  beforeEach(() => localStorage.removeItem('telemetry'))
  afterEach(() => localStorage.removeItem('telemetry'))

  it('is on until it is turned off', async () => {
    const { getTelemetryPreference, setTelemetryPreference } = await import(
      '../src/js/preferences.ts'
    )
    expect(getTelemetryPreference()).to.equal(true)
    setTelemetryPreference(false)
    expect(getTelemetryPreference()).to.equal(false)
    expect(localStorage.getItem('telemetry')).to.equal('false')
    setTelemetryPreference(true)
    expect(getTelemetryPreference()).to.equal(true)
  })

  it('says when it changes, on the window', async () => {
    const { setTelemetryPreference, TelemetryPreferenceEvent } = await import(
      '../src/js/preferences.ts'
    )
    const seen: boolean[] = []
    const listener = (event: Event) =>
      seen.push((event as InstanceType<typeof TelemetryPreferenceEvent>).enabled)
    window.addEventListener(TelemetryPreferenceEvent.type, listener)
    try {
      setTelemetryPreference(false)
      setTelemetryPreference(true)
    } finally {
      window.removeEventListener(TelemetryPreferenceEvent.type, listener)
    }
    expect(seen).to.deep.equal([false, true])
  })
})

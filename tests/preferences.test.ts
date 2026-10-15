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
  'keep_awake_minutes',
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
    expect(preferences.getMusicianType()).to.equal('drummer')
    expect(preferences.getCapoPreference()).to.equal(true)
  })
  afterEach(() => {
    for (const key of KEYS) localStorage.removeItem(key)
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

  describe('the musician type', () => {
    it('sets what each part of a song shows by default, and says so', async () => {
      const preferences = await fresh()
      const expected: Record<string, string> = {
        general: 'all',
        singer: 'lyrics',
        drummer: 'lyrics',
        guitarist: 'all',
        nonsense: 'all',
      }
      for (const [type, shown] of Object.entries(expected)) {
        const events = heard<InstanceType<Preferences['SectionDefaultsEvent']>>(
          'preferences:section-defaults-changed',
          () => preferences.setMusicianType(type)
        )
        expect(events[0].defaults, type).to.deep.equal({ all: shown })
        expect(JSON.parse(localStorage.getItem('section_defaults') ?? ''), type).to.deep.equal({
          all: shown,
        })
        expect(preferences.getMusicianType()).to.equal(type === 'nonsense' ? 'general' : type)
      }
    })
  })

  describe('the capo', () => {
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

    it('has a limit of an hour until one is chosen, and only takes the ones on offer', async () => {
      const preferences = await fresh()
      expect(preferences.getKeepAwakeMinutes()).to.equal(60)
      const events = heard<InstanceType<Preferences['KeepAwakeLimitEvent']>>(
        'preferences:keep-awake-limit-changed',
        () => {
          preferences.setKeepAwakeMinutes(30)
          preferences.setKeepAwakeMinutes(7)
        }
      )
      expect(events.map(event => event.minutes)).to.deep.equal([30, 60])
      preferences.setKeepAwakeMinutes(120)
      expect(preferences.getKeepAwakeMinutes()).to.equal(120)
      localStorage.setItem('keep_awake_minutes', '7')
      expect(preferences.getKeepAwakeMinutes()).to.equal(60)
    })

    it('turns the limit into milliseconds, or none', async () => {
      const preferences = await fresh()
      expect(preferences.keepAwakeLimitMs(15)).to.equal(15 * 60 * 1000)
      expect(preferences.keepAwakeLimitMs(0)).to.equal(Number.POSITIVE_INFINITY)
      expect(preferences.keepAwakeLimitMs()).to.equal(60 * 60 * 1000)
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
      expect(preferences.getKeepAwakeMinutes()).to.equal(60)
      expect(() => preferences.setKeepAwakePreference(false)).to.not.throw()
      expect(() => preferences.setKeepAwakeMinutes(30)).to.not.throw()
    })

    it('copes with not being able to save the capo', async () => {
      const preferences = await fresh()
      block()
      preferences.setCapoPreference(true)
      expect(preferences.getCapoPreference()).to.equal(true)
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

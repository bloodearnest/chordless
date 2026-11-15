import { expect, fixture, html } from '@open-wc/testing'
import type { AppPreferences } from '../src/components/app-preferences.ts'
import { KeepAwakeLimitEvent, KeepAwakePreferenceEvent } from '../src/js/preferences.ts'
import { WakeLockController, WakeLockStateEvent, wakeLock } from '../src/js/wake-lock.ts'
import { suppressConsoleLogs } from './test-helpers.ts'
import '../src/components/app-preferences.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const KEYS = [
  'use-nashville',
  'use-unicode-accidentals',
  'musician_type',
  'section_defaults',
  'enable_capo',
  'enabled_capo',
  'tuning',
  'enable_pitch',
  'pitch',
  'keep_screen_awake',
  'scroll_to_top_on_swipe',
  'keep_awake_minutes',
]

describe('app-preferences', () => {
  const restores: Array<() => void> = []
  beforeEach(() => {
    for (const key of KEYS) localStorage.removeItem(key)
  })
  afterEach(() => {
    while (restores.length) restores.pop()?.()
    for (const key of KEYS) localStorage.removeItem(key)
  })

  /** Make the wake lock say something else until the test is over */
  function pretend(target: object, name: string, value: unknown) {
    const own = Object.getOwnPropertyDescriptor(target, name)
    Object.defineProperty(target, name, { get: () => value, configurable: true })
    restores.push(() => {
      if (own) Object.defineProperty(target, name, own)
      else delete (target as Record<string, unknown>)[name]
    })
  }

  const show = () => fixture<AppPreferences>(html`<app-preferences></app-preferences>`)
  const control = <T extends HTMLElement>(el: AppPreferences, selector: string) =>
    el.shadowRoot?.querySelector(selector) as T

  describe('the layout', () => {
    it('has three panels: Appearance, Behaviour and options, and Accessibility last', async () => {
      const el = await show()
      const headings = [...(el.shadowRoot?.querySelectorAll('.panel > h3') ?? [])].map(
        h => h.textContent
      )
      expect(headings).to.deep.equal(['Appearance', 'Behaviour and options', 'Accessibility'])
      const panels = el.shadowRoot?.querySelectorAll('.panel')
      expect(panels?.[2]?.querySelector('readability-settings')).to.not.equal(null)
    })

    it('has neither the annotations nor the usage reports', async () => {
      const el = await show()
      expect(el.shadowRoot?.querySelector('#toggle-my-annotations')).to.equal(null)
      expect(el.shadowRoot?.querySelector('#toggle-telemetry')).to.equal(null)
    })
  })

  describe('the choices', () => {
    const radios = (el: AppPreferences) => [
      ...(el.shadowRoot?.querySelectorAll<HTMLInputElement>('input[name="musician-type"]') ?? []),
    ]

    it('asks what the person plays, and sets the switches the answer stands for', async () => {
      const el = await show()
      const [singer, guitarist, transposing, other] = radios(el)
      expect(radios(el).length).to.equal(5)
      singer.click()
      expect(localStorage.getItem('musician_type')).to.equal('singer')
      expect(el.musicianType).to.equal('singer')
      expect(JSON.parse(localStorage.getItem('section_defaults') ?? '')).to.deep.equal({
        all: 'lyrics',
      })
      guitarist.click()
      expect(localStorage.getItem('enable_capo')).to.equal('true')
      expect(el.capoEnabled).to.equal(true)
      transposing.click()
      expect(localStorage.getItem('enable_pitch')).to.equal('true')
      expect(el.pitchControls).to.equal(true)
      expect(localStorage.getItem('enable_capo')).to.equal('false')
      other.click()
      expect(localStorage.getItem('enable_pitch')).to.equal('false')
      expect(localStorage.getItem('musician_type')).to.equal('general')
      expect(localStorage.getItem('enable_capo')).to.equal('false')
      expect(el.capoEnabled).to.equal(false)
    })

    it('shows the switches for Custom only, each kept as it is changed', async () => {
      const el = await show()
      expect(control(el, '#toggle-lyrics-only')).to.equal(null)
      expect(control(el, '#toggle-capo')).to.equal(null)
      radios(el)[4].click()
      await el.updateComplete
      expect(el.musicianType).to.equal('custom')
      control<HTMLInputElement>(el, '#toggle-lyrics-only').click()
      control<HTMLInputElement>(el, '#toggle-capo').click()
      expect(JSON.parse(localStorage.getItem('section_defaults') ?? '')).to.deep.equal({
        all: 'lyrics',
      })
      expect(localStorage.getItem('enable_capo')).to.equal('true')
      // (it stays Custom, though these two make no type)
      expect(el.musicianType).to.equal('custom')
      // (and a type chosen after is shown by its radio button, with the switches it set)
      radios(el)[0].click()
      await el.updateComplete
      expect(el.capoEnabled).to.equal(false)
      expect(el.lyricsOnly).to.equal(true)
    })

    it('has the instrument pitch only when its controls are on, and keeps the choice', async () => {
      const el = await show()
      expect(control(el, '#pitch')).to.equal(null)
      radios(el)[2].click()
      await el.updateComplete
      const select = control<HTMLSelectElement>(el, '#pitch')
      expect(select.value).to.equal('concert')
      expect([...select.options].map(option => option.value)).to.deep.equal([
        'concert',
        'bb',
        'eb',
        'f',
      ])
      select.value = 'eb'
      select.dispatchEvent(new Event('change'))
      expect(localStorage.getItem('pitch')).to.equal('eb')
      expect(el.pitch).to.equal('eb')
      // (and it goes with the controls: a guitarist has no horn; Custom can have both)
      radios(el)[1].click()
      await el.updateComplete
      expect(control(el, '#pitch')).to.equal(null)
      expect(localStorage.getItem('pitch')).to.equal('eb')
      radios(el)[4].click()
      await el.updateComplete
      control<HTMLInputElement>(el, '#toggle-pitch').click()
      await el.updateComplete
      expect(control(el, '#pitch')).to.not.equal(null)
      expect(control(el, '#tuning')).to.not.equal(null)
    })

    it('has the guitar’s tuning only when the capo and tuning controls are on, and keeps the choice', async () => {
      const el = await show()
      expect(control(el, '#tuning')).to.equal(null)
      radios(el)[1].click()
      await el.updateComplete
      const select = control<HTMLSelectElement>(el, '#tuning')
      expect(select.value).to.equal('0')
      expect([...select.options].map(option => option.textContent?.trim())).to.deep.equal([
        'Standard',
        'Half step down',
        'Whole step down',
      ])
      select.value = '1'
      select.dispatchEvent(new Event('change'))
      expect(localStorage.getItem('tuning')).to.equal('1')
      expect(el.tuning).to.equal(1)
      // (and it goes with the controls: a singer has no guitar)
      radios(el)[0].click()
      await el.updateComplete
      expect(control(el, '#tuning')).to.equal(null)
      expect(localStorage.getItem('tuning')).to.equal('1')
    })

    it('shows the type the switches make when it is opened', async () => {
      localStorage.setItem('enable_capo', 'true')
      const el = await show()
      expect(el.musicianType).to.equal('guitarist')
      expect(radios(el)[1].checked).to.equal(true)
    })

    it('keeps the toggles', async () => {
      const el = await show()
      for (const [id, key, value] of [
        ['#toggle-use-nashville', 'use-nashville', '1'],
        ['#toggle-unicode-accidentals', 'use-unicode-accidentals', '1'],
        ['#toggle-real-book', 'lead-sheet-real-book', '1'],
        ['#toggle-keep-awake', 'keep_screen_awake', 'false'],
        ['#toggle-scroll-to-top', 'scroll_to_top_on_swipe', 'false'],
      ] as const) {
        control<HTMLInputElement>(el, id).click()
        expect(localStorage.getItem(key), id).to.equal(value)
      }
    })

    it('keeps the limit chosen', async () => {
      const el = await show()
      pretend(WakeLockController, 'supported', true)
      el.keepAwake = true
      await el.updateComplete
      const select = control<HTMLSelectElement>(el, '#keep-awake-limit')
      select.value = '30'
      select.dispatchEvent(new Event('change'))
      expect(localStorage.getItem('keep_awake_minutes')).to.equal('30')
      expect(el.keepAwakeMinutes).to.equal(30)
    })

    it('follows the keep-awake choices made elsewhere, until it is removed', async () => {
      const el = await show()
      window.dispatchEvent(new KeepAwakePreferenceEvent(false))
      window.dispatchEvent(new KeepAwakeLimitEvent(120))
      expect(el.keepAwake).to.equal(false)
      expect(el.keepAwakeMinutes).to.equal(120)
      el.remove()
      window.dispatchEvent(new KeepAwakePreferenceEvent(true))
      expect(el.keepAwake).to.equal(false)
    })

    it('draws again when the wake lock changes', async () => {
      const el = await show()
      let renders = 0
      const render = el.render.bind(el)
      el.render = () => {
        renders++
        return render()
      }
      window.dispatchEvent(new WakeLockStateEvent('active'))
      await el.updateComplete
      expect(renders).to.equal(1)
    })
  })

  describe('the limit in words', () => {
    it('says minutes, an hour, hours, or none', async () => {
      const el = await show()
      expect(el._limitLabel(15)).to.equal('15 minutes')
      expect(el._limitLabel(60)).to.equal('1 hour')
      expect(el._limitLabel(120)).to.equal('2 hours')
      expect(el._limitLabel(0)).to.equal('no limit')
    })
  })

  describe('what the wake lock is doing', () => {
    const display = async (state: string, extra: Record<string, unknown> = {}) => {
      pretend(wakeLock, 'state', state)
      for (const [name, value] of Object.entries(extra)) pretend(wakeLock, name, value)
      const el = await show()
      return el._wakeLockDisplay()
    }

    it('says each state', async () => {
      expect((await display('unsupported')).label).to.equal('Unsupported')
      expect((await display('off')).label).to.equal('Off')
      expect((await display('released')).label).to.equal('Let go')
      expect((await display('expired')).detail).to.contain('Let go after')
      expect((await display('failed', { error: 'NotAllowedError' })).detail).to.contain(
        'NotAllowedError'
      )
      expect((await display('idle')).label).to.equal('Ready')
      expect((await display('something-new')).label).to.equal('Ready')
    })

    it('says it is awake, with what applies: a limit on battery, none on mains or with no limit', async () => {
      pretend(wakeLock, 'live', false)
      pretend(wakeLock, 'onMains', false)
      expect((await display('active')).detail).to.match(
        /awake, until there is no touch for 30 minutes\.$/
      )
      restores.pop()
      pretend(wakeLock, 'live', true)
      expect((await display('active')).detail).to.contain(
        'while you are live, until there is no touch'
      )
    })

    it('has no limit to speak of on mains power', async () => {
      pretend(wakeLock, 'live', false)
      pretend(wakeLock, 'onMains', true)
      expect((await display('active')).detail).to.equal('The screen is being kept awake.')
    })

    it('has no limit to speak of when there is none chosen', async () => {
      localStorage.setItem('keep_awake_minutes', '0')
      pretend(wakeLock, 'live', true)
      pretend(wakeLock, 'onMains', false)
      expect((await display('active')).detail).to.equal(
        'The screen is being kept awake, on any page, while you are live.'
      )
    })

    it('says whether it is on mains power', async () => {
      const el = await show()
      pretend(wakeLock, 'onMains', true)
      expect(el._powerStatus()).to.contain('no time limit')
      pretend(wakeLock, 'onMains', false)
      expect(el._powerStatus()).to.contain('On battery')
      pretend(wakeLock, 'onMains', null)
      expect(el._powerStatus()).to.contain("can't say")
    })
  })

  describe('the wake lock button', () => {
    it('is not there when the browser cannot keep the screen awake', async () => {
      pretend(WakeLockController, 'supported', false)
      const el = await show()
      expect(el._wakeLockAction()).to.equal(null)
      expect(control(el, '.panel .btn')).to.equal(null)
    })

    it('asks again after the device let go', async () => {
      pretend(WakeLockController, 'supported', true)
      for (const state of ['released', 'failed', 'expired']) {
        pretend(wakeLock, 'state', state)
        const el = await show()
        expect(el._wakeLockAction()?.label, state).to.equal('Ask again')
      }
    })

    it('is not offered when nothing was let go, live or not', async () => {
      pretend(WakeLockController, 'supported', true)
      pretend(wakeLock, 'state', 'idle')
      for (const live of [true, false]) {
        pretend(wakeLock, 'live', live)
        const el = await show()
        expect(el._wakeLockAction()).to.equal(null)
      }
    })

    it('is not needed while a setlist holds it', async () => {
      pretend(WakeLockController, 'supported', true)
      pretend(wakeLock, 'state', 'active')
      pretend(wakeLock, 'live', false)
      const el = await show()
      expect(el._wakeLockAction()).to.equal(null)
    })

    it('is shown as a button, which does what it says', async () => {
      pretend(WakeLockController, 'supported', true)
      pretend(wakeLock, 'state', 'released')
      const asked: string[] = []
      const realAgain = wakeLock.requestAgain
      wakeLock.requestAgain = (async () => {
        asked.push('again')
      }) as typeof wakeLock.requestAgain
      restores.push(() => {
        wakeLock.requestAgain = realAgain
      })
      const el = await show()
      control<HTMLButtonElement>(el, '.panel .btn').click()
      expect(asked).to.deep.equal(['again'])
    })
  })
})

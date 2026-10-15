import { expect, fixture, html } from '@open-wc/testing'
import type { AppAbout } from '../src/components/app-about.ts'
import { AppUpdateChangeEvent, appUpdate } from '../src/js/app-update.ts'
import { INSTALL_CHANGE_EVENT } from '../src/js/install.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'
import '../src/components/app-about.ts'

const { describe, it, afterEach } = window

suppressConsoleLogs()

describe('app-about', () => {
  const restores: Array<() => void> = []
  afterEach(() => {
    while (restores.length) restores.pop()?.()
  })

  /** Make a property of an object read as something else, until the test is over */
  function pretend(target: object, name: string, value: unknown) {
    const own = Object.getOwnPropertyDescriptor(target, name)
    Object.defineProperty(target, name, { get: () => value, configurable: true })
    restores.push(() => {
      if (own) Object.defineProperty(target, name, own)
      else delete (target as Record<string, unknown>)[name]
    })
  }
  function replaceMethod<T extends object, K extends keyof T>(target: T, name: K, value: T[K]) {
    const real = target[name]
    target[name] = value
    restores.push(() => {
      target[name] = real
    })
  }

  const show = async () => {
    const el = await fixture<AppAbout>(html`<app-about></app-about>`)
    await wait(30)
    await el.updateComplete
    return el
  }
  const state = (el: AppAbout, id: string) =>
    el.shadowRoot?.querySelector(`#${id}`)?.getAttribute('data-state')
  const text = (el: AppAbout) => el.shadowRoot?.textContent?.replace(/\s+/g, ' ') ?? ''

  describe('the update panel', () => {
    const statusWith = async (flags: Record<string, unknown>) => {
      for (const [name, value] of Object.entries(flags)) pretend(appUpdate, name, value)
      return (await show())._updateStatus().state
    }

    it('says each state the update is in', async () => {
      const none = {
        ready: false,
        installing: false,
        checking: false,
        failed: false,
        available: true,
      }
      expect(await statusWith({ ...none, ready: true })).to.equal('ready')
      expect(await statusWith({ ...none, installing: true })).to.equal('installing')
      expect(await statusWith({ ...none, checking: true })).to.equal('checking')
      expect(await statusWith({ ...none, failed: true })).to.equal('failed')
      expect(await statusWith({ ...none, available: false })).to.equal('none')
      expect(await statusWith({ ...none, lastChecked: null })).to.equal('current')
    })

    it('says when it last checked', async () => {
      pretend(appUpdate, 'ready', false)
      pretend(appUpdate, 'installing', false)
      pretend(appUpdate, 'checking', false)
      pretend(appUpdate, 'failed', false)
      pretend(appUpdate, 'available', true)
      pretend(appUpdate, 'lastChecked', Date.now() - 5 * 60_000)
      const el = await show()
      expect(el._updateStatus().detail).to.equal('Checked 5 minutes ago.')
    })

    it('tells how long ago in words', async () => {
      const el = await show()
      el._now = 10 * 3_600_000
      expect(el._ago(el._now - 10_000)).to.equal('just now')
      expect(el._ago(el._now - 60_000)).to.equal('1 minute ago')
      expect(el._ago(el._now - 5 * 60_000)).to.equal('5 minutes ago')
      expect(el._ago(el._now - 3_600_000)).to.equal('1 hour ago')
      expect(el._ago(el._now - 3 * 3_600_000)).to.equal('3 hours ago')
    })

    it('offers to reload when an update is ready, and to check otherwise', async () => {
      pretend(appUpdate, 'ready', true)
      let applied = 0
      replaceMethod(appUpdate, 'apply', (async () => {
        applied++
      }) as typeof appUpdate.apply)
      let el = await show()
      el.shadowRoot?.querySelector<HTMLButtonElement>('.btn.primary')?.click()
      expect(applied).to.equal(1)
      for (const restore of restores.splice(0)) restore()

      pretend(appUpdate, 'available', true)
      let checks = 0
      replaceMethod(appUpdate, 'check', (async () => {
        checks++
      }) as typeof appUpdate.check)
      el = await show()
      el.shadowRoot?.querySelector<HTMLButtonElement>('.actions .btn')?.click()
      await wait(20)
      expect(checks).to.equal(1)
    })

    it('has the check button off while it is checking, installing, or cannot', async () => {
      for (const flag of ['checking', 'installing']) {
        pretend(appUpdate, 'ready', false)
        pretend(appUpdate, 'available', true)
        pretend(appUpdate, flag, true)
        const el = await show()
        expect(
          el.shadowRoot?.querySelector<HTMLButtonElement>('.actions .btn')?.disabled,
          flag
        ).to.equal(true)
        for (const restore of restores.splice(0)) restore()
      }
      pretend(appUpdate, 'ready', false)
      pretend(appUpdate, 'available', false)
      const el = await show()
      expect(el.shadowRoot?.querySelector<HTMLButtonElement>('.actions .btn')?.disabled).to.equal(
        true
      )
    })

    it('draws again when the update changes', async () => {
      const el = await show()
      let renders = 0
      const render = el.render.bind(el)
      el.render = () => {
        renders++
        return render()
      }
      window.dispatchEvent(new AppUpdateChangeEvent(true))
      await el.updateComplete
      expect(renders).to.equal(1)
      el.remove()
      window.dispatchEvent(new AppUpdateChangeEvent(false))
      await wait(10)
      expect(renders).to.equal(1)
    })
  })

  describe('the version', () => {
    it('says which, and when it was released', async () => {
      const el = await show()
      el._running = null
      expect(el._versionLine()).to.equal('Version unknown')
      el._running = { version: 'abc123', released: '' }
      expect(el._versionLine()).to.equal('Version abc123')
      el._running = { version: 'abc123', released: 'not a date' }
      expect(el._versionLine()).to.equal('Version abc123')
      el._running = { version: 'abc123', released: '2026-10-12' }
      expect(el._versionLine()).to.match(/^Version abc123, released .*2026/)
    })
  })

  describe('offline', () => {
    it('is ready when this version’s files are saved, and not yet when they are not', async () => {
      const el = await show()
      el._offline = true
      expect(el._offlineStatus().state).to.equal('ready')
      el._offline = false
      expect(el._offlineStatus().state).to.equal('not-yet')
    })

    it('is not offered when the browser cannot say, or has no service worker', async () => {
      const el = await show()
      el._offline = null
      expect(el._offlineStatus().state).to.equal('none')
      el._offline = true
      pretend(navigator, 'serviceWorker', undefined)
      expect(el._offlineStatus().state).to.equal('none')
    })

    it('is found out by asking for this version’s cache, and is not known when that fails', async () => {
      replaceMethod(appUpdate, 'runningVersion', async () => ({ version: 'v-test', released: '' }))
      const asked: string[] = []
      pretend(window, 'caches', {
        has: async (name: string) => {
          asked.push(name)
          return true
        },
      })
      let el = await show()
      expect(asked).to.deep.equal(['cache-v-test'])
      expect(el._offline).to.equal(true)
      pretend(window, 'caches', {
        has: async () => {
          throw new Error('denied')
        },
      })
      el = await show()
      expect(el._offline).to.equal(null)
    })

    it('is not ready when there is no running version', async () => {
      replaceMethod(appUpdate, 'runningVersion', async () => null)
      const el = await show()
      expect(el._offline).to.equal(false)
    })
  })

  describe('install', () => {
    it('says each way it can be, and offers to install when the browser can', async () => {
      const el = await show()
      for (const mode of ['installed', 'prompt', 'ios', 'mac-safari', 'none'] as const) {
        el._installMode = mode
        expect(el._installStatus().state, mode).to.equal(mode)
      }
      await el.updateComplete
      expect(el.shadowRoot?.querySelector('.actions .btn.primary')).to.equal(null)
      el._installMode = 'prompt'
      await el.updateComplete
      expect(text(el)).to.contain('Install Chordless')
    })

    it('goes on to ask the browser to install, and then looks again', async () => {
      const el = await show()
      el._installMode = 'ios'
      await el._install()
      expect(el._installMode).to.not.equal('ios')
    })

    it('follows the install state while it is on the page', async () => {
      const el = await show()
      el._installMode = 'ios'
      window.dispatchEvent(new Event(INSTALL_CHANGE_EVENT))
      expect(el._installMode).to.not.equal('ios')
      el.remove()
      el._installMode = 'ios'
      window.dispatchEvent(new Event(INSTALL_CHANGE_EVENT))
      expect(el._installMode).to.equal('ios')
    })
  })

  describe('storage', () => {
    it('says whether the browser keeps it, and how much is used', async () => {
      const el = await show()
      el._storage = { persisted: true, usage: 3_200_000 }
      expect(el._storageStatus().state).to.equal('persistent')
      expect(el._storageStatus().detail).to.contain('Using 3.2 MB')
      el._storage = { persisted: false, usage: null }
      expect(el._storageStatus().state).to.equal('best-effort')
      expect(el._storageStatus().detail).to.not.contain('Using')
      el._storage = { persisted: null, usage: 0 }
      expect(el._storageStatus().state).to.equal('unknown')
      el._storage = null
      expect(el._storageStatus().state).to.equal('unknown')
    })

    it('gives sizes in words', async () => {
      const el = await show()
      expect(el._size(512)).to.equal('512 B')
      expect(el._size(3_200_000)).to.equal('3.2 MB')
      expect(el._size(24_000_000_000)).to.equal('24 GB')
      expect(el._size(12_000)).to.equal('12 KB')
      expect(el._size(5e15)).to.equal('5000 TB')
    })

    it('offers to ask the browser to keep it only when it does not', async () => {
      const el = await show()
      el._storage = { persisted: true, usage: null }
      await el.updateComplete
      expect(text(el)).to.not.contain('Ask the browser to keep it')
      el._storage = { persisted: false, usage: null }
      await el.updateComplete
      expect(text(el)).to.contain('Ask the browser to keep it')
    })

    it('is read from the browser, whatever it says', async () => {
      pretend(navigator, 'storage', {
        persisted: async () => true,
        estimate: async () => ({ usage: 1234 }),
      })
      let el = await show()
      expect(el._storage).to.deep.equal({ persisted: true, usage: 1234 })

      pretend(navigator, 'storage', {
        persisted: () => Promise.reject(new Error('no')),
        estimate: () => Promise.reject(new Error('no')),
      })
      el = await show()
      expect(el._storage).to.deep.equal({ persisted: null, usage: null })

      pretend(navigator, 'storage', {})
      el = await show()
      expect(el._storage).to.deep.equal({ persisted: null, usage: null })

      pretend(navigator, 'storage', {
        persisted: async () => false,
        estimate: async () => ({}),
      })
      el = await show()
      expect(el._storage).to.deep.equal({ persisted: false, usage: null })

      pretend(navigator, 'storage', undefined)
      el = await show()
      expect(el._storage).to.deep.equal({ persisted: null, usage: null })
    })

    it('asks the browser to keep it, and looks again, and puts up with a refusal', async () => {
      let asked = 0
      pretend(navigator, 'storage', {
        persist: async () => {
          asked++
          return true
        },
        persisted: async () => true,
        estimate: async () => ({ usage: 1 }),
      })
      const el = await show()
      await el._protect()
      expect(asked).to.equal(1)
      pretend(navigator, 'storage', {
        persist: async () => {
          throw new Error('refused')
        },
        persisted: async () => false,
        estimate: async () => ({ usage: 1 }),
      })
      await el._protect()
      expect(el._storage?.persisted).to.equal(false)
    })
  })

  it('shows each panel’s state', async () => {
    const el = await show()
    for (const id of ['update-status', 'offline-status', 'install-status', 'storage-status']) {
      expect(state(el, id), id).to.be.a('string')
    }
    expect(el.shadowRoot?.querySelector('#app-version')).to.not.equal(null)
  })
})

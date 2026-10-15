import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import type { StorageSummary } from '../src/components/storage-summary.ts'
import { suppressConsoleLogs } from './test-helpers.ts'
import '../src/components/storage-summary.ts'

const { describe, it, afterEach } = window

suppressConsoleLogs()

type Stats = Awaited<ReturnType<StorageSummary['_loadStats']>>

describe('storage-summary', () => {
  const restores: Array<() => void> = []
  afterEach(() => {
    while (restores.length) restores.pop()?.()
  })

  /** Replace a property of window or navigator until the test is over */
  function replace(target: object, name: string, value: unknown) {
    const own = Object.getOwnPropertyDescriptor(target, name)
    Object.defineProperty(target, name, { value, configurable: true })
    restores.push(() => {
      if (own) Object.defineProperty(target, name, own)
      else delete (target as Record<string, unknown>)[name]
    })
  }

  /** The text it shows, once it shows this */
  async function shown(el: StorageSummary, text: string) {
    const read = () => el.shadowRoot?.textContent?.replace(/\s+/g, ' ') ?? ''
    await waitUntil(() => read().includes(text), `it shows ${text}`)
    return read()
  }

  const bare = () => document.createElement('storage-summary') as StorageSummary
  const stats = (over: Partial<Stats> = {}): Stats => ({
    setlists: 2,
    songs: 5,
    dbBytes: 2048,
    appCacheBytes: 3 * 1024 * 1024,
    mediaCacheBytes: 1536,
    ...over,
  })

  describe('as shown', () => {
    it('shows the counts and sizes', async () => {
      const el = bare()
      el._loadStats = async () => stats()
      document.body.append(el)
      const text = await shown(el, 'Setlists')
      expect(text).to.contain('Setlists 2')
      expect(text).to.contain('Songs 5')
      expect(text).to.contain('DB 2.0 KB')
      expect(text).to.contain('App Cache 3.0 MB')
      expect(text).to.contain('Media Cache 1.5 KB')
      el.remove()
    })

    it('shows a dash for sizes it cannot tell', async () => {
      const el = bare()
      el._loadStats = async () => stats({ appCacheBytes: null, mediaCacheBytes: null })
      document.body.append(el)
      expect(await shown(el, 'App Cache')).to.contain('App Cache – Media Cache –')
      el.remove()
    })

    it('says so when it cannot read the details', async () => {
      const el = bare()
      el._loadStats = async () => {
        throw new Error('no database')
      }
      document.body.append(el)
      expect(await shown(el, 'Unable to read')).to.contain('Unable to read local storage details')
      el.remove()
    })

    it('says it is loading until then', async () => {
      const el = bare()
      el._loadStats = () => new Promise(() => {})
      document.body.append(el)
      await el.updateComplete
      expect(el.shadowRoot?.textContent).to.contain('Loading')
      el.remove()
    })

    it('reads the real database when it is not told otherwise', async () => {
      const el = await fixture<StorageSummary>(html`<storage-summary></storage-summary>`)
      expect(await shown(el, 'Setlists')).to.contain('Setlists')
    })
  })

  describe('formatting', () => {
    it('gives bytes in the unit that fits, and a dash for none', () => {
      const el = bare()
      expect(el._formatBytes(null)).to.equal('–')
      expect(el._formatBytes(512)).to.equal('512 B')
      expect(el._formatBytes(1536)).to.equal('1.5 KB')
      expect(el._formatBytes(5 * 1024 * 1024)).to.equal('5.0 MB')
      expect(el._formatBytes(1024 ** 5 * 3)).to.equal('3072.0 TB')
      expect(el._formatMegabytes(null)).to.equal('–')
      expect(el._formatMegabytes(1.5 * 1024 * 1024)).to.equal('1.5 MB')
      expect(el._formatMegabytes(20 * 1024 * 1024)).to.equal('20 MB')
    })
  })

  describe('the database size', () => {
    it('is what the browser says IndexedDB uses', async () => {
      replace(navigator, 'storage', {
        estimate: async () => ({ usageDetails: { indexedDB: 4096 } }),
      })
      expect(await bare()._estimateIndexedDbUsage()).to.equal(4096)
    })

    it('is nothing known when the browser cannot say, or fails to', async () => {
      replace(navigator, 'storage', { estimate: async () => ({ usage: 1 }) })
      expect(await bare()._estimateIndexedDbUsage()).to.equal(null)
      replace(navigator, 'storage', {
        estimate: async () => {
          throw new Error('denied')
        },
      })
      expect(await bare()._estimateIndexedDbUsage()).to.equal(null)
      replace(navigator, 'storage', undefined)
      expect(await bare()._estimateIndexedDbUsage()).to.equal(null)
    })

    it('is measured from the records when the browser cannot say', async () => {
      replace(navigator, 'storage', undefined)
      const el = bare()
      expect((await el._loadStats()).dbBytes).to.be.a('number')
    })
  })

  describe('the caches', () => {
    const request = (path: string) => new Request(`https://app.test${path}`)

    /** A CacheStorage of these caches: each a list of [path, bytes] (null: gone by the time it is read) */
    function fakeCaches(contents: Record<string, Array<[string, number | null]>>) {
      return {
        keys: async () => Object.keys(contents),
        open: async (name: string) => ({
          keys: async () => contents[name].map(([path]) => request(path)),
          match: async (req: Request) => {
            const entry = contents[name].find(([path]) => req.url.endsWith(path))
            return entry?.[1] == null ? undefined : new Response(new Uint8Array(entry[1]))
          },
        }),
      }
    }

    it('adds up what the app keeps and what the pads are, by what they are named', async () => {
      replace(
        window,
        'caches',
        fakeCaches({
          app: [
            ['/index.js', 100],
            ['/songs', 10],
            ['/icons/a.PNG', 5],
            ['/pads/C.mp3', 1000],
            ['/pads/readme.', 1],
          ],
          pads: [['/pad-sets/x/D.MP3', 2000]],
        })
      )
      expect(await bare()._estimateCacheUsage()).to.deep.equal({ appBytes: 116, mediaBytes: 3000 })
    })

    it('skips an entry that is gone by the time it is read', async () => {
      replace(
        window,
        'caches',
        fakeCaches({
          app: [
            ['/gone.js', null],
            ['/here.js', 7],
          ],
        })
      )
      expect(await bare()._estimateCacheUsage()).to.deep.equal({ appBytes: 7, mediaBytes: 0 })
    })

    it('leaves the sizes unknown in the stats when it cannot look at the caches', async () => {
      replace(window, 'caches', undefined)
      const stats = await bare()._loadStats()
      expect(stats.appCacheBytes).to.equal(null)
      expect(stats.mediaCacheBytes).to.equal(null)
    })

    it('is nothing known with no Cache Storage, or when it cannot be read', async () => {
      replace(window, 'caches', undefined)
      expect(await bare()._estimateCacheUsage()).to.equal(null)
      replace(window, 'caches', {
        keys: async () => {
          throw new Error('denied')
        },
      })
      expect(await bare()._estimateCacheUsage()).to.equal(null)
    })
  })
})

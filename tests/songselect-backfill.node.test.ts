/**
 * The script that fetches a library's charts and lead sheets again, in the console on SongSelect
 * (scripts/songselect-backfill.js), and the generator that gives it a library
 * (scripts/make-songselect-backfill.ts). It is tried against a SongSelect and a folder made here:
 * the real one wants a login, and the tests must not send it requests.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { backfillScript, songsOfExport } from '../scripts/make-songselect-backfill.ts'
import { writeZip } from '../src/js/utils/zip.ts'

type Backfill = (songs: [string, string][], overrides?: Record<string, unknown>) => Promise<any>
let backfill: Backfill
;(globalThis as any).songSelectBackfillHook = (fn: Backfill) => {
  backfill = fn
}
await import(new URL('../scripts/songselect-backfill.js', import.meta.url).href)

const PDF = '%PDF-1.4 a lead sheet'
const chordpro = (title: string, key: string | null = 'G') =>
  `{title: ${title}}\n${key ? `{key: ${key}}\n` : ''}\n[G]Words`

interface Reply {
  status?: number
  body?: unknown
  headers?: Record<string, string>
  /** What the answer says, when it is not JSON with a payload */
  raw?: string | Uint8Array
}

/** A SongSelect: what it answers for a number's chart and lead sheet (a list is answers in turn) */
function fakeSongSelect(
  charts: Record<string, Reply | Reply[]> = {},
  leads: Record<string, Reply | Reply[]> = {}
) {
  const requests: string[] = []
  const next = (table: Record<string, Reply | Reply[]>, number: string): Reply => {
    const entry = table[number]
    if (Array.isArray(entry)) return entry.length > 1 ? (entry.shift() as Reply) : entry[0]
    return entry ?? { status: 404 }
  }
  const respond = (reply: Reply) => {
    const status = reply.status ?? 200
    const text =
      reply.raw !== undefined
        ? reply.raw
        : JSON.stringify(typeof reply.body === 'string' ? { payload: reply.body } : reply.body)
    const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (name: string) => reply.headers?.[name.toLowerCase()] ?? null },
      json: async () => JSON.parse(new TextDecoder().decode(bytes)),
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    }
  }
  return {
    requests,
    fetch: async (url: string) => {
      requests.push(url)
      const number = /songNumber=(\d+)/.exec(url)?.[1] as string
      return respond(next(url.includes('GetSongLeadPdf') ? leads : charts, number))
    },
  }
}

/** A folder to save in, in memory */
function fakeFolder(manifest: unknown = null) {
  const files = new Map<string, string | Uint8Array>()
  const manifests: unknown[] = []
  return {
    files,
    manifests,
    io: {
      write: async (name: string, data: string | Uint8Array) => {
        files.set(name, data)
      },
      readManifest: async () => manifest,
      writeManifest: async (value: unknown) => {
        manifests.push(JSON.parse(JSON.stringify(value)))
      },
    },
  }
}

/** The pauses a run asked for, with the clock stopped: it never waits, and says how long it would */
function fakeClock() {
  const pauses: number[] = []
  return {
    pauses,
    sleep: async (ms: number) => {
      pauses.push(ms)
    },
    random: () => 0.5,
    now: () => '2026-11-03T10:00:00.000Z',
  }
}

const quiet = () => {
  const lines: string[] = []
  return { lines, log: (...message: unknown[]) => lines.push(message.join(' ')) }
}

function run(
  songs: [string, string][],
  site: ReturnType<typeof fakeSongSelect>,
  folder = fakeFolder(),
  extra: Record<string, unknown> = {}
) {
  const clock = fakeClock()
  const out = quiet()
  const result = backfill(songs, {
    hostname: 'songselect.ccli.com',
    fetch: site.fetch,
    io: folder.io,
    ...clock,
    ...out,
    ...extra,
  })
  return result.then(done => ({ done, clock, out, folder }))
}

describe('the backfill script', () => {
  afterEach(() => {
    delete (globalThis as any).stopSongSelectBackfill
  })

  test('saves each chart and its lead sheet, named by number and title', async () => {
    const site = fakeSongSelect(
      {
        '111': { body: chordpro('Washed', 'B') },
        '222': { body: chordpro('Great Are You Lord', 'A') },
      },
      { '111': { raw: PDF }, '222': { raw: PDF } }
    )
    const { done, folder } = await run(
      [
        ['111', 'Washed'],
        ['222', 'Great Are You Lord'],
      ],
      site
    )
    assert.deepEqual([...folder.files.keys()].sort(), [
      '111-Washed.cho',
      '111-lead-B.pdf',
      '222-Great-Are-You-Lord.cho',
      '222-lead-A.pdf',
    ])
    assert.equal(folder.files.get('111-Washed.cho'), chordpro('Washed', 'B'))
    assert.equal(new TextDecoder().decode(folder.files.get('222-lead-A.pdf') as Uint8Array), PDF)
    assert.deepEqual(
      { ...done },
      {
        done: 2,
        withoutLeadSheet: 0,
        failed: 0,
        noChart: 0,
        stopped: false,
        problem: '',
      }
    )
  })

  test('asks for the chart in no key of its own, so SongSelect gives the song’s, and for the lead sheet in the chart’s', async () => {
    const site = fakeSongSelect(
      { '111': { body: chordpro('Song', 'F#') } },
      { '111': { raw: PDF } }
    )
    await run([['111', 'Song']], site)
    assert.equal(site.requests.length, 2)
    assert.equal(site.requests[0], '/api/GetSongChordPro?songNumber=111&style=Standard&columns=1')
    assert.ok(!site.requests[0].includes('key='))
    assert.equal(
      site.requests[1],
      '/api/GetSongLeadPdf?songNumber=111&transposeKey=F%23&octave=0&noteSize=0&orientation=portrait&paperSize=A4&activityType=downloaded&renderer=pipeline'
    )
  })

  test('sends the headers the bookmarklet does, with the login', async () => {
    const seen: any[] = []
    await run(
      [['111', 'Song']],
      fakeSongSelect({ '111': { body: chordpro('Song') } }),
      fakeFolder(),
      {
        fetch: async (_url: string, init: unknown) => {
          seen.push(init)
          return fakeSongSelect({ '111': { body: chordpro('Song') } }).fetch('/x?songNumber=111')
        },
      }
    )
    assert.deepEqual(seen[0], {
      headers: { accept: '*/*', 'client-locale': 'en-GB' },
      credentials: 'include',
    })
  })

  test('pauses before every request, for a time between the limits, and never goes faster', async () => {
    const site = fakeSongSelect(
      { '1': { body: chordpro('One') }, '2': { body: chordpro('Two') } },
      { '1': { raw: PDF }, '2': { raw: PDF } }
    )
    const { clock } = await run(
      [
        ['1', 'One'],
        ['2', 'Two'],
      ],
      site
    )
    // four requests, each after a pause: random 0.5 of 4000 to 7000
    assert.deepEqual(clock.pauses, [5500, 5500, 5500, 5500])
    const slow = await run([['1', 'One']], site, fakeFolder(), {
      delayMs: [1000, 3000],
      random: () => 0,
    })
    assert.deepEqual(slow.clock.pauses[0], 1000)
  })

  test('says how long it will take', async () => {
    const site = fakeSongSelect({})
    const { out } = await run(
      Array.from({ length: 12 }, (_, i) => [String(i), `Song ${i}`] as [string, string]),
      site,
      fakeFolder(),
      { maxFailuresInARow: 1 }
    )
    // 12 songs, two requests each, 5.5 s each: 132 s
    assert.match(out.lines[0], /12 songs, 0 done already: 12 to fetch\. About 3 minutes/)
  })

  test('carries on where it stopped: a song done is not asked for again', async () => {
    const folder = fakeFolder({
      done: { '1': { title: 'One', key: 'G', lead: true, at: 'before' } },
      failed: { '2': { title: 'Two', reason: 'it failed', at: 'before' } },
    })
    const site = fakeSongSelect(
      { '2': { body: chordpro('Two') }, '3': { body: chordpro('Three') } },
      { '2': { raw: PDF }, '3': { raw: PDF } }
    )
    const { done, out } = await run(
      [
        ['1', 'One'],
        ['2', 'Two'],
        ['3', 'Three'],
      ],
      site,
      folder
    )
    assert.ok(
      site.requests.every(url => !url.includes('songNumber=1&') && !url.includes('songNumber=1'))
    )
    assert.equal(site.requests.filter(url => url.includes('GetSongChordPro')).length, 2)
    // (the one that failed before is tried again, and is no longer failed)
    assert.equal(done.done, 3)
    assert.equal(done.failed, 0)
    assert.match(out.lines[0], /3 songs, 1 done already: 2 to fetch/)
  })

  test('keeps a manifest of what is done, written after each song', async () => {
    const site = fakeSongSelect(
      { '1': { body: chordpro('One') }, '2': { body: chordpro('Two') } },
      { '1': { raw: PDF }, '2': { status: 404 } }
    )
    const { folder } = await run(
      [
        ['1', 'One'],
        ['2', 'Two'],
      ],
      site
    )
    const [afterOne, afterTwo] = folder.manifests as any[]
    assert.deepEqual(Object.keys(afterOne.done), ['1'])
    assert.deepEqual(afterTwo.done['2'], {
      title: 'Two',
      key: 'G',
      lead: false,
      leadReason: 'SongSelect said 404',
      at: '2026-11-03T10:00:00.000Z',
    })
    assert.equal(afterOne.done['1'].lead, true)
  })

  describe('when SongSelect says to slow down', () => {
    test('waits as long as it says, and then tries again', async () => {
      const site = fakeSongSelect({
        '1': [{ status: 429, headers: { 'retry-after': '7' } }, { body: chordpro('One') }],
      })
      const { clock, done } = await run([['1', 'One']], site, fakeFolder(), { random: () => 0 })
      // the pause before the request, then 7 s (with no jitter), then the lead sheet's pause
      assert.deepEqual(clock.pauses.slice(0, 2), [4000, 7000])
      assert.equal(site.requests.filter(url => url.includes('GetSongChordPro')).length, 2)
      assert.equal(done.done, 1)
    })

    test('waits longer each time when it is not told how long, and gives up after its tries', async () => {
      const site = fakeSongSelect({ '1': { status: 503 } })
      const { clock, done, out } = await run([['1', 'One']], site, fakeFolder(), {
        random: () => 0,
        retries: 3,
        backoffMs: 1000,
      })
      assert.deepEqual(clock.pauses, [4000, 1000, 2000, 4000])
      assert.equal(site.requests.length, 4)
      assert.equal(done.failed, 1)
      assert.ok(out.lines.some(line => line.includes('failed (SongSelect said 503)')))
    })

    test('tries again when there is no answer at all, and fails the song if there never is', async () => {
      let calls = 0
      const { clock, done, out } = await run([['1', 'One']], fakeSongSelect(), fakeFolder(), {
        random: () => 0,
        retries: 2,
        backoffMs: 500,
        fetch: async () => {
          calls++
          throw new Error('Failed to fetch')
        },
      })
      assert.equal(calls, 3)
      assert.deepEqual(clock.pauses, [4000, 500, 1000])
      assert.equal(done.failed, 1)
      assert.ok(out.lines.some(line => line.includes('no answer (Failed to fetch)')))
    })

    test('carries on to the next song after one that failed', async () => {
      const site = fakeSongSelect(
        { '1': { status: 500 }, '2': { body: chordpro('Two') } },
        { '2': { raw: PDF } }
      )
      const { done } = await run(
        [
          ['1', 'One'],
          ['2', 'Two'],
        ],
        site,
        fakeFolder(),
        { retries: 0 }
      )
      assert.equal(done.done, 1)
      assert.equal(done.failed, 1)
    })

    test('stops when songs keep failing, and says to wait', async () => {
      const site = fakeSongSelect({})
      const songs = Array.from(
        { length: 8 },
        (_, i) => [String(i), `Song ${i}`] as [string, string]
      )
      const { done } = await run(songs, site, fakeFolder(), { maxFailuresInARow: 3 })
      assert.equal(site.requests.length, 3)
      assert.match(done.problem, /3 songs failed in a row.*Wait a while, then run it again/)
    })

    test('does not count a failure that a success broke up', async () => {
      const site = fakeSongSelect({ '2': { body: chordpro('Two') } }, { '2': { raw: PDF } })
      const songs = ['1', '2', '3', '4'].map(n => [n, `Song ${n}`] as [string, string])
      const { done } = await run(songs, site, fakeFolder(), { maxFailuresInARow: 2 })
      // 1 fails, 2 works, 3 fails, 4 fails: two in a row at the end
      assert.equal(done.done, 1)
      assert.equal(site.requests.filter(url => url.includes('GetSongChordPro')).length, 4)
      assert.match(done.problem, /2 songs failed in a row/)
    })
  })

  describe('when it is not signed in', () => {
    test('stops, and says so, on a 403', async () => {
      const site = fakeSongSelect({ '1': { status: 403 }, '2': { body: chordpro('Two') } })
      const { done, out } = await run(
        [
          ['1', 'One'],
          ['2', 'Two'],
        ],
        site
      )
      assert.equal(site.requests.length, 1)
      assert.match(done.problem, /signed out, or no access/)
      assert.ok(out.lines.some(line => line.includes('signed out')))
      assert.equal(done.failed, 0)
    })

    test('stops on a sign-in page where the chart should be', async () => {
      const site = fakeSongSelect({ '1': { raw: '<html>Sign in</html>' } })
      const { done } = await run([['1', 'One']], site)
      assert.match(done.problem, /signed out/)
    })

    test('keeps what it saved before, and says where it stopped', async () => {
      const site = fakeSongSelect(
        { '1': { body: chordpro('One') }, '2': { status: 401 } },
        { '1': { raw: PDF } }
      )
      const { folder } = await run(
        [
          ['1', 'One'],
          ['2', 'Two'],
        ],
        site
      )
      assert.ok(folder.files.has('1-One.cho'))
      const last = folder.manifests[folder.manifests.length - 1] as any
      assert.deepEqual(Object.keys(last.done), ['1'])
    })
  })

  describe('the lead sheet', () => {
    test('is left out, and the chart kept, when SongSelect has none', async () => {
      for (const status of [404, 403, 500]) {
        const site = fakeSongSelect({ '1': { body: chordpro('One') } }, { '1': { status } })
        const { done, folder } = await run([['1', 'One']], site, fakeFolder(), { retries: 0 })
        assert.ok(folder.files.has('1-One.cho'), String(status))
        assert.ok(![...folder.files.keys()].some(name => name.endsWith('.pdf')), String(status))
        assert.equal(done.withoutLeadSheet, 1, String(status))
        assert.equal(done.failed, 0, String(status))
      }
    })

    test('is left out when what came is not a PDF', async () => {
      const site = fakeSongSelect(
        { '1': { body: chordpro('One') } },
        { '1': { raw: '<html>No</html>' } }
      )
      const { done, folder } = await run([['1', 'One']], site)
      assert.equal(done.withoutLeadSheet, 1)
      assert.ok(![...folder.files.keys()].some(name => name.endsWith('.pdf')))
      const last = folder.manifests[folder.manifests.length - 1] as any
      assert.equal(last.done['1'].leadReason, 'not a PDF')
    })

    test('can come as JSON with the PDF in base64, as the ChordPro does', async () => {
      const site = fakeSongSelect({ '1': { body: chordpro('One') } }, { '1': { body: btoa(PDF) } })
      const { folder } = await run([['1', 'One']], site)
      assert.equal(new TextDecoder().decode(folder.files.get('1-lead-G.pdf') as Uint8Array), PDF)
    })

    test('is not an answer in base64 that is no PDF', async () => {
      const site = fakeSongSelect(
        { '1': { body: chordpro('One') } },
        { '1': { body: btoa('hello') } }
      )
      const { done } = await run([['1', 'One']], site)
      assert.equal(done.withoutLeadSheet, 1)
    })

    test('is not asked for when the chart has no key to ask in', async () => {
      const site = fakeSongSelect({ '1': { body: chordpro('One', null) } }, { '1': { raw: PDF } })
      const { done, folder } = await run([['1', 'One']], site)
      assert.equal(site.requests.length, 1)
      assert.equal(done.withoutLeadSheet, 1)
      const last = folder.manifests[folder.manifests.length - 1] as any
      assert.match(last.done['1'].leadReason, /no key/)
    })
  })

  test('saves a chart, and fails the song, when the chart is empty or SongSelect has none', async () => {
    const site = fakeSongSelect({ '1': { body: '  ' }, '2': { status: 404 } })
    const { done, folder } = await run(
      [
        ['1', 'One'],
        ['2', 'Two'],
      ],
      site
    )
    assert.equal(done.failed, 2)
    assert.equal(folder.files.size, 0) // (nothing saved)
  })

  describe('a song SongSelect has no ChordPro for', () => {
    // (it answers with a sentence, as if it were the chart)
    const SENTENCE = 'no chordPro for this song'

    test('is not saved as a chart, and is listed as left out', async () => {
      const site = fakeSongSelect({ '1': { body: SENTENCE }, '2': { body: chordpro('Two') } })
      const { done, folder, out } = await run(
        [
          ['1', 'One'],
          ['2', 'Two'],
        ],
        site
      )
      assert.deepEqual([...folder.files.keys()], ['2-Two.cho'])
      assert.equal(done.noChart, 1)
      assert.equal(done.failed, 0)
      assert.ok(
        out.lines.some(line =>
          line.includes(
            'left out (SongSelect has no ChordPro for it ("no chordPro for this song"))'
          )
        )
      )
      assert.ok(
        out.lines.some(line =>
          line.startsWith('SongSelect has no ChordPro for 1, left out: One (1)')
        )
      )
      const last = folder.manifests[folder.manifests.length - 1] as any
      assert.equal(last.failed['1'].noChart, true)
    })

    test('is not SongSelect limiting the requests: it does not count toward giving up', async () => {
      const songs = Array.from(
        { length: 8 },
        (_, i) => [String(i), `Song ${i}`] as [string, string]
      )
      const site = fakeSongSelect(Object.fromEntries(songs.map(([n]) => [n, { body: SENTENCE }])))
      const { done } = await run(songs, site, fakeFolder(), { maxFailuresInARow: 3 })
      assert.equal(site.requests.length, 8)
      assert.equal(done.noChart, 8)
      assert.equal(done.problem, '')
    })

    test('still says what to do next, as the others were saved', async () => {
      const site = fakeSongSelect(
        { '1': { body: SENTENCE }, '2': { body: chordpro('Two') } },
        { '2': { raw: PDF } }
      )
      const { out } = await run(
        [
          ['1', 'One'],
          ['2', 'Two'],
        ],
        site
      )
      assert.ok(out.lines.some(line => line.startsWith('Next: in Chordless')))
      assert.ok(out.lines.some(line => line.includes('the manifest is passed over')))
    })

    test('is not asked for again when the script is run again', async () => {
      const folder = fakeFolder({
        done: {},
        failed: { '1': { title: 'One', reason: 'no', noChart: true, at: 'before' } },
      })
      const site = fakeSongSelect({ '2': { body: chordpro('Two') } }, { '2': { raw: PDF } })
      await run(
        [
          ['1', 'One'],
          ['2', 'Two'],
        ],
        site,
        folder
      )
      assert.ok(site.requests.every(url => !url.includes('songNumber=1&')))
      assert.equal(site.requests.filter(url => url.includes('GetSongChordPro')).length, 1)
    })

    test('is told from a chart that is only chords, or only directives', async () => {
      const site = fakeSongSelect({
        '1': { body: '[G]Only a chord' },
        '2': { body: '{title: Only a directive}' },
        '3': { body: '{"json": "is not ChordPro"}' },
      })
      const { done, folder } = await run(
        [
          ['1', 'One'],
          ['2', 'Two'],
          ['3', 'Three'],
        ],
        site
      )
      assert.equal(done.noChart, 1)
      assert.ok(folder.files.has('1-One.cho'))
      assert.ok(folder.files.has('2-Only-a-directive.cho'))
    })
  })

  test('names a file from the chart’s title, made safe, or from the library’s when it has none', async () => {
    const site = fakeSongSelect({
      '1': { body: '{title: Café: “Holy” / Forever?!}\n{key: C}\n[C]x' },
      '2': { body: '{key: C}\n[C]x' },
      '3': { body: '{title: !!!}\n{key: C}\n[C]x' },
    })
    const { folder } = await run(
      [
        ['1', 'Cafe'],
        ['2', 'From the Library'],
        ['3', 'Symbols'],
      ],
      site
    )
    const names = [...folder.files.keys()].filter(name => name.endsWith('.cho')).sort()
    assert.deepEqual(names, ['1-Cafe-Holy-Forever.cho', '2-From-the-Library.cho', '3-song.cho'])
  })

  test('can be stopped between songs, and says so', async () => {
    const site = fakeSongSelect(
      { '1': { body: chordpro('One') }, '2': { body: chordpro('Two') } },
      { '1': { raw: PDF }, '2': { raw: PDF } }
    )
    const folder = fakeFolder()
    const write = folder.io.write
    folder.io.write = async (name, data) => {
      await write(name, data)
      // (the person types stopSongSelectBackfill() while the first song is saved)
      if (name.endsWith('.pdf')) (globalThis as any).stopSongSelectBackfill()
    }
    const { done, out } = await run(
      [
        ['1', 'One'],
        ['2', 'Two'],
      ],
      site,
      folder
    )
    assert.equal(done.stopped, true)
    assert.equal(done.done, 1)
    assert.ok(out.lines.some(line => line.includes('Stopping after the song it is on')))
    assert.ok(out.lines.some(line => line.endsWith('(Stopped.)')))
  })

  test('says what to do next when all is done, and lists the songs it could not get', async () => {
    const site = fakeSongSelect({ '1': { body: chordpro('One') } }, { '1': { raw: PDF } })
    const { out } = await run([['1', 'One']], site)
    assert.ok(out.lines.some(line => line.startsWith('Next: in Chordless')))
    const failing = await run([['1', 'One']], fakeSongSelect({ '1': { status: 404 } }))
    assert.ok(failing.out.lines.some(line => line.startsWith('Failed: One (1)')))
    assert.ok(!failing.out.lines.some(line => line.startsWith('Next:')))
  })

  describe('where it runs', () => {
    test('only on SongSelect', async () => {
      const out = quiet()
      const result = await backfill([['1', 'One']], {
        hostname: 'example.com',
        fetch: () => assert.fail('it must not ask anyone else'),
        ...out,
      })
      assert.equal(result, null)
      assert.match(out.lines[0], /Run this on https:\/\/songselect\.ccli\.com/)
    })

    test('needs a browser that can save to a folder', async () => {
      const out = quiet()
      const result = await backfill([['1', 'One']], { hostname: 'songselect.ccli.com', ...out })
      assert.equal(result, null)
      assert.match(out.lines[0], /Chrome or Edge/)
    })

    describe('with a folder the person chooses', () => {
      /** A folder, as the browser gives one: handles to files, written through a stream */
      function directoryHandle(existing: Record<string, string> = {}) {
        const files = new Map<string, string | Uint8Array>(Object.entries(existing))
        return {
          files,
          getFileHandle: async (name: string, options?: { create?: boolean }) => {
            if (!files.has(name) && !options?.create) {
              throw Object.assign(new Error('not found'), { name: 'NotFoundError' })
            }
            return {
              createWritable: async () => ({
                write: async (data: string | Uint8Array) => {
                  files.set(name, data)
                },
                close: async () => {},
              }),
              getFile: async () => ({ text: async () => String(files.get(name)) }),
            }
          },
        }
      }

      afterEach(() => {
        delete (globalThis as any).showDirectoryPicker
      })

      test('asks for the folder first, saves into it, and writes its manifest there', async () => {
        const directory = directoryHandle()
        const asked: unknown[] = []
        ;(globalThis as any).showDirectoryPicker = (options: unknown) => {
          asked.push(options)
          return Promise.resolve(directory)
        }
        const site = fakeSongSelect({ '1': { body: chordpro('One') } }, { '1': { raw: PDF } })
        const clock = fakeClock()
        await backfill([['1', 'One']], {
          hostname: 'songselect.ccli.com',
          fetch: site.fetch,
          ...clock,
          ...quiet(),
        })
        assert.deepEqual(asked, [{ id: 'chordless-backfill', mode: 'readwrite' }])
        assert.deepEqual([...directory.files.keys()].sort(), [
          '1-One.cho',
          '1-lead-G.pdf',
          'backfill-manifest.json',
        ])
        assert.equal(
          JSON.parse(directory.files.get('backfill-manifest.json') as string).done['1'].lead,
          true
        )
      })

      test('carries on from the manifest that is in the folder', async () => {
        const directory = directoryHandle({
          'backfill-manifest.json': JSON.stringify({
            done: { '1': { title: 'One', key: 'G', lead: true } },
            failed: {},
          }),
        })
        ;(globalThis as any).showDirectoryPicker = () => Promise.resolve(directory)
        const site = fakeSongSelect({ '2': { body: chordpro('Two') } }, { '2': { raw: PDF } })
        await backfill(
          [
            ['1', 'One'],
            ['2', 'Two'],
          ],
          { hostname: 'songselect.ccli.com', fetch: site.fetch, ...fakeClock(), ...quiet() }
        )
        assert.equal(site.requests.filter(url => url.includes('GetSongChordPro')).length, 1)
        assert.ok(site.requests[0].includes('songNumber=2'))
      })

      test('says so, and does nothing, when no folder is chosen', async () => {
        ;(globalThis as any).showDirectoryPicker = () =>
          Promise.reject(Object.assign(new Error('The user aborted'), { name: 'AbortError' }))
        const out = quiet()
        const result = await backfill([['1', 'One']], {
          hostname: 'songselect.ccli.com',
          fetch: () => assert.fail('nothing is asked for without a folder'),
          ...out,
        })
        assert.equal(result, null)
        assert.match(out.lines[0], /No folder was chosen \(AbortError\)/)
      })
    })
  })
})

describe('the script that is made for a library', () => {
  const exportOf = async (songs: unknown[], created = '2026-10-23T15:30:47.165Z') =>
    writeZip([
      { name: 'manifest.json', data: JSON.stringify({ format: 'chordless-export', created }) },
      { name: 'songs.json', data: JSON.stringify(songs) },
    ])
  const record = (title: string, ccliNumber: string | null, isDefault = true) => ({
    title,
    ccliNumber,
    isDefault,
    id: ccliNumber ? `ccli-${ccliNumber}` : `title-${title}`,
  })

  test('has each song of the library with a CCLI number once, by title, and says which have none', async () => {
    const zip = await exportOf([
      record('Zion', '300'),
      record('Amazing', '100'),
      record('Kings Version', '200', false),
      record('Kings', '200', true),
      record('Hand Made', null),
    ])
    const { songs, withoutCcli, created } = await songsOfExport(zip)
    assert.deepEqual(songs, [
      ['100', 'Amazing'],
      ['200', 'Kings'],
      ['300', 'Zion'],
    ])
    assert.deepEqual(withoutCcli, ['Hand Made'])
    assert.equal(created, '2026-10-23T15:30:47.165Z')
  })

  test('takes the title of whichever variant there is when none is the default', async () => {
    const { songs } = await songsOfExport(await exportOf([record('Only', '5', false)]))
    assert.deepEqual(songs, [['5', 'Only']])
  })

  test('says so when the file is not an export', async () => {
    await assert.rejects(
      songsOfExport(await writeZip([{ name: 'x.txt', data: 'x' }])),
      /no songs\.json/
    )
    const noManifest = await writeZip([{ name: 'songs.json', data: '[]' }])
    await assert.rejects(songsOfExport(noManifest), /no manifest\.json/)
  })

  test('is the script, then a call of it on the songs', async () => {
    const script = backfillScript(
      [
        ['100', 'Amazing'],
        ['200', 'Kings'],
      ],
      'async function songSelectBackfill() {}\n',
      new Date('2026-11-03T10:00:00Z')
    )
    assert.match(
      script,
      /^\/\/ Made by scripts\/make-songselect-backfill\.ts on 2026-11-03: 2 songs/
    )
    assert.ok(script.includes('async function songSelectBackfill() {}'))
    assert.ok(
      script.endsWith('songSelectBackfill([\n  ["100","Amazing"],\n  ["200","Kings"],\n])\n')
    )
  })

  test('is valid JavaScript, made from the real script', async () => {
    const { readFileSync } = await import('node:fs')
    const template = readFileSync(
      new URL('../scripts/songselect-backfill.js', import.meta.url),
      'utf8'
    )
    const script = backfillScript([['100', 'Amazing']], template)
    // (parsed, not run: it would ask SongSelect)
    assert.doesNotThrow(() => new Function(script))
    assert.ok(script.includes('async function songSelectBackfill('))
    assert.ok(script.endsWith('songSelectBackfill([\n  ["100","Amazing"],\n])\n'))
  })
})

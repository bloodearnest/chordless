/**
 * Fetch every chart of a library from SongSelect again, to put the charts in SongSelect's own key
 * and give each song its melody range from its lead sheet (docs/REIMPORT.md).
 *
 * It runs in the Chrome DevTools console on https://songselect.ccli.com, signed in, as the script
 * that scripts/make-songselect-backfill.ts makes: this, with the library's CCLI numbers after it.
 * For each song it asks SongSelect for the ChordPro (in the song's own key: no key is asked for)
 * and for the lead sheet in that key, and saves both to a folder the person chooses. It is kept
 * from tripping SongSelect's limits by going slowly, one request at a time, with a pause (that
 * varies) before each; by waiting longer and trying again when SongSelect says to slow down; and by
 * stopping when it keeps failing. It remembers what it has done in the folder (the manifest), so
 * running it again carries on where it stopped.
 *
 * It does not need to open a song's page, or Chordless: SongSelect's own pages call the same
 * addresses, with the same login.
 */
async function songSelectBackfill(songs, overrides = {}) {
  const settings = {
    /** The wait before each request, in milliseconds: somewhere between these */
    delayMs: [4000, 7000],
    /** How many times to try a request again, and how long to wait the first time (it doubles) */
    retries: 3,
    backoffMs: 30000,
    /** Songs that fail one after another before it gives up: SongSelect is likely limiting it */
    maxFailuresInARow: 5,
    hostname: globalThis.location?.hostname,
    fetch: (url, init) => globalThis.fetch(url, init),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    random: Math.random,
    log: (...message) => console.log(...message),
    now: () => new Date().toISOString(),
    /** Where the files go: given by a test. Otherwise the person chooses a folder */
    io: null,
    ...overrides,
  }
  const { log } = settings
  const MANIFEST = 'backfill-manifest.json'

  if (settings.hostname !== 'songselect.ccli.com') {
    log('Run this on https://songselect.ccli.com, signed in.')
    return null
  }
  // (the folder picker wants the key press that ran this, so it is asked for before anything waits)
  const picking = settings.io
    ? null
    : globalThis.showDirectoryPicker?.({ id: 'chordless-backfill', mode: 'readwrite' })
  if (!settings.io && !picking) {
    log('This needs Chrome or Edge, which can save files to a folder.')
    return null
  }
  let io = settings.io
  if (!io) {
    try {
      io = folderIo(await picking)
    } catch (error) {
      log(`No folder was chosen (${error?.name ?? error}).`)
      return null
    }
  }

  const manifest = (await io.readManifest()) ?? { done: {}, failed: {} }
  let stopped = false
  globalThis.stopSongSelectBackfill = () => {
    stopped = true
    log('Stopping after the song it is on. Running it again carries on from there.')
  }

  // ---- one song ----

  async function fetchSong(ccli, title) {
    const chartResponse = await request(
      `/api/GetSongChordPro?songNumber=${ccli}&style=Standard&columns=1`
    )
    if (chartResponse.status === 401 || chartResponse.status === 403) throw signedOut()
    if (!chartResponse.ok) throw new Error(`SongSelect said ${chartResponse.status}`)
    let payload
    try {
      payload = (await chartResponse.json()).payload
    } catch {
      // (a sign-in page where the chart should be)
      throw signedOut()
    }
    if (!payload?.trim()) throw new Error('an empty chart: no access to this song?')
    // (SongSelect answers a song that has no ChordPro with a sentence, as if it were the chart)
    if (!looksLikeChordPro(payload)) {
      const error = new Error(
        `SongSelect has no ChordPro for it ("${payload.trim().slice(0, 60)}")`
      )
      error.noChart = true
      throw error
    }

    const key = /\{key:\s*([^}\s]+)\s*\}/i.exec(payload)?.[1] ?? null
    const name = `${ccli}-${slug(/\{title:\s*([^}]+)\}/i.exec(payload)?.[1] ?? title)}`
    await io.write(`${name}.cho`, payload)
    if (!key) return { key, lead: false, leadReason: 'the chart has no key to ask for it in' }

    // The lead sheet in the chart's own key, so the notes are in the key the chart is in
    const leadResponse = await request(
      `/api/GetSongLeadPdf?songNumber=${ccli}&transposeKey=${encodeURIComponent(key)}&octave=0&noteSize=0&orientation=portrait&paperSize=A4&activityType=downloaded&renderer=pipeline`
    )
    if (leadResponse.status === 401 || leadResponse.status === 403) {
      return { key, lead: false, leadReason: `SongSelect said ${leadResponse.status}` }
    }
    const bytes = leadResponse.ok ? await pdfBytes(leadResponse) : null
    if (!bytes) {
      return {
        key,
        lead: false,
        leadReason: leadResponse.ok ? 'not a PDF' : `SongSelect said ${leadResponse.status}`,
      }
    }
    await io.write(`${ccli}-lead-${key.replace('#', 'sharp')}.pdf`, bytes)
    return { key, lead: true }
  }

  // ---- requests: slowly, and again when told to wait ----

  async function request(path) {
    await settings.sleep(between(settings.delayMs))
    let wait = settings.backoffMs
    for (let attempt = 0; ; attempt++) {
      let response = null
      try {
        response = await settings.fetch(path, {
          headers: { accept: '*/*', 'client-locale': 'en-GB' },
          credentials: 'include',
        })
      } catch (error) {
        if (attempt >= settings.retries) throw new Error(`no answer (${error.message})`)
      }
      const slowDown = response && [429, 500, 502, 503, 504].includes(response.status)
      if (response && (!slowDown || attempt >= settings.retries)) return response
      // (SongSelect may say how long: else it is a longer wait each time)
      const told = Number(response?.headers?.get('retry-after'))
      const ms = told > 0 ? told * 1000 : wait
      log(`  waiting ${Math.round(ms / 1000)} s (${response ? response.status : 'no answer'})`)
      await settings.sleep(ms + between([0, 2000]))
      wait *= 2
    }
  }

  // ---- helpers ----

  function between([low, high]) {
    return low + settings.random() * (high - low)
  }

  function average([low, high]) {
    return (low + high) / 2
  }

  /** Whether what SongSelect gave is a ChordPro chart: it has a directive ({title: …}) or a chord ([G]) */
  function looksLikeChordPro(text) {
    return /\{\s*[a-z_]+\s*:/i.test(text) || /\[[A-G][^\]]*\]/.test(text)
  }

  function signedOut() {
    const error = new Error('SongSelect did not give the chart: signed out, or no access to it?')
    error.signedOut = true
    return error
  }

  /** The PDF, which SongSelect gives as it is or, like the ChordPro, as JSON with it in base64 */
  async function pdfBytes(response) {
    const isPdf = data => String.fromCharCode(...data.slice(0, 4)) === '%PDF'
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (isPdf(bytes)) return bytes
    try {
      const { payload } = JSON.parse(new TextDecoder().decode(bytes))
      const decoded = Uint8Array.from(atob(payload), character => character.charCodeAt(0))
      return isPdf(decoded) ? decoded : null
    } catch {
      return null
    }
  }

  function slug(text) {
    const plain = text
      .normalize('NFKD')
      .replace(/[^\w]+/g, '-')
      .replace(/^-+|-+$/g, '')
    return plain.slice(0, 60) || 'song'
  }

  /** Files in a folder the person chose (a FileSystemDirectoryHandle) */
  function folderIo(directory) {
    const write = async (name, data) => {
      const handle = await directory.getFileHandle(name, { create: true })
      const writable = await handle.createWritable()
      await writable.write(data)
      await writable.close()
    }
    return {
      write,
      async readManifest() {
        try {
          const handle = await directory.getFileHandle(MANIFEST)
          return JSON.parse(await (await handle.getFile()).text())
        } catch {
          return null
        }
      },
      writeManifest: manifestToWrite => write(MANIFEST, JSON.stringify(manifestToWrite, null, 2)),
    }
  }

  // ---- the songs, one after another ----

  // (a song SongSelect has no ChordPro for is not asked for again)
  const todo = songs.filter(([ccli]) => !manifest.done[ccli] && !manifest.failed[ccli]?.noChart)
  log(
    `${songs.length} songs, ${songs.length - todo.length} done already: ${todo.length} to fetch. ` +
      `About ${Math.ceil((todo.length * 2 * average(settings.delayMs)) / 60000)} minutes. ` +
      'To stop: stopSongSelectBackfill()'
  )

  let failuresInARow = 0
  let problem = ''
  for (const [index, [ccli, title]] of todo.entries()) {
    if (stopped) break
    const label = `[${index + 1}/${todo.length}] ${title} (${ccli})`
    try {
      const result = await fetchSong(ccli, title)
      manifest.done[ccli] = { title, ...result, at: settings.now() }
      delete manifest.failed[ccli]
      failuresInARow = 0
      log(
        `${label}: chart in ${result.key ?? 'no key'}, ` +
          (result.lead ? 'lead sheet' : `no lead sheet (${result.leadReason})`)
      )
    } catch (error) {
      if (error.signedOut) {
        problem = error.message
        log(`${label}: ${error.message}`)
        break
      }
      manifest.failed[ccli] = {
        title,
        reason: error.message,
        ...(error.noChart && { noChart: true }),
        at: settings.now(),
      }
      log(`${label}: ${error.noChart ? 'left out' : 'failed'} (${error.message})`)
      // (a song with no ChordPro is nothing to do with SongSelect limiting the requests)
      if (!error.noChart) failuresInARow++
      if (failuresInARow >= settings.maxFailuresInARow) {
        problem = `${failuresInARow} songs failed in a row: SongSelect may be limiting requests. Wait a while, then run it again.`
        log(problem)
        break
      }
    }
    await io.writeManifest(manifest)
  }
  await io.writeManifest(manifest)

  const noLead = Object.values(manifest.done).filter(song => !song.lead)
  const notDone = Object.entries(manifest.failed).filter(([ccli]) => !manifest.done[ccli])
  const noChart = notDone.filter(([, song]) => song.noChart)
  const failed = notDone.filter(([, song]) => !song.noChart)
  const named = list => list.map(([ccli, song]) => `${song.title} (${ccli})`).join(', ')
  log(
    `Done: ${Object.keys(manifest.done).length} songs saved, ${noLead.length} without a lead sheet, ` +
      `${failed.length} failed.${stopped ? ' (Stopped.)' : ''}`
  )
  if (noChart.length)
    log(`SongSelect has no ChordPro for ${noChart.length}, left out:`, named(noChart))
  if (failed.length) log('Failed:', named(failed))
  if (!problem && !stopped && !failed.length) {
    log(
      'Next: in Chordless, Import ChordPro Files, and choose every file in that folder ' +
        '(the manifest is passed over).'
    )
  }
  return {
    done: Object.keys(manifest.done).length,
    withoutLeadSheet: noLead.length,
    failed: failed.length,
    noChart: noChart.length,
    stopped,
    problem,
  }
}

// (for the tests, which are given the function: there is no hook in the console)
if (typeof globalThis.songSelectBackfillHook === 'function') {
  globalThis.songSelectBackfillHook(songSelectBackfill)
}

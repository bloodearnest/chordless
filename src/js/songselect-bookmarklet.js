/**
 * The SongSelect bookmarklet.
 *
 * importFromSongSelect is the bookmarklet itself. It runs on a SongSelect song
 * page, not in Chordless, and is turned into a javascript: URL from its own
 * source (Function.prototype.toString), so it must be self-contained: no
 * imports, no references to anything outside the function. It uses the browser
 * through `page` (the window), so tests can pass a stand-in.
 *
 * It opens Chordless's /import-song in the tab named 'chordless' (reusing one
 * this SongSelect tab opened before), fetches the song's ChordPro meanwhile
 * (using the user's SongSelect login), waits for CHORDLESS_READY, and posts
 * CHORDLESS_IMPORT, or CHORDLESS_IMPORT_FAILED if the download failed. See
 * song-import.js.
 */
export async function importFromSongSelect(chordlessUrl, page = window) {
  if (!page.location.href.includes('songselect.ccli.com')) {
    page.alert('Please navigate to a SongSelect song page first.')
    return
  }
  const urlMatch = page.location.href.match(/\/songs\/(\d+)/)
  if (!urlMatch) {
    page.alert('❌ Could not extract song number from URL')
    return
  }
  const songNumber = urlMatch[1]
  const title = page.document.querySelector('h1')?.textContent.trim()
  const keyMatch = page.document.body.textContent.match(/Key:\s*([A-G][b#]?)/i)
  const key = keyMatch ? keyMatch[1] : 'C'

  // Listen before opening: the import page says it's ready as soon as it loads
  let resolveReady
  const ready = new Promise(resolve => {
    resolveReady = resolve
  })
  const onMessage = event => {
    if (event.origin === chordlessUrl && event.data?.type === 'CHORDLESS_READY') resolveReady()
  }
  page.addEventListener('message', onMessage)

  // Open Chordless first, straight from the click: opening a tab after awaiting
  // the download isn't a user action any more, and browsers block it as a popup.
  // A tab named 'chordless' that this page opened before is reused.
  const tab = page.open(`${chordlessUrl}/import-song`, 'chordless')
  if (!tab) {
    page.removeEventListener('message', onMessage)
    page.alert('⚠️ Popup blocked. Please allow popups.')
    return
  }

  let message
  try {
    const response = await page.fetch(
      `https://songselect.ccli.com/api/GetSongChordPro?songNumber=${songNumber}&key=${key}&style=Number&columns=1`,
      { headers: { accept: '*/*', 'client-locale': 'en-GB' }, credentials: 'include' }
    )
    if (!response.ok) throw new Error(`SongSelect download failed: ${response.status}`)
    const chordproText = (await response.json()).payload
    if (!chordproText?.trim()) throw new Error('Empty ChordPro file. Do you have access?')
    message = {
      type: 'CHORDLESS_IMPORT',
      data: {
        chordproText,
        metadata: { ccliNumber: songNumber, title, key },
        source: 'songselect',
      },
    }
  } catch (error) {
    // Tell the import page, so it doesn't wait for a song that isn't coming
    message = { type: 'CHORDLESS_IMPORT_FAILED', data: { message: error.message } }
  }

  const timedOut = new Promise(resolve => page.setTimeout(() => resolve('timeout'), 20000))
  const outcome = await Promise.race([ready, timedOut])
  page.removeEventListener('message', onMessage)
  if (outcome === 'timeout') {
    page.alert('⚠️ Timeout waiting for Chordless')
    return
  }
  tab.postMessage(message, chordlessUrl)
}

/**
 * The bookmarklet as a javascript: URL that imports into the Chordless at
 * `origin`. Fully percent-encoded, so pasting it into a bookmark's URL field
 * keeps its line breaks.
 */
export function bookmarkletUrl(origin) {
  return `javascript:${encodeURIComponent(`(${importFromSongSelect})(${JSON.stringify(origin)})`)}`
}

/**
 * The SongSelect bookmarklet.
 *
 * importFromSongSelect is the bookmarklet itself. It runs on a SongSelect song
 * page, not in Chordless, and is turned into a javascript: URL from its own
 * source (Function.prototype.toString), so it must be self-contained: no
 * imports, no references to anything outside the function.
 *
 * It fetches the song's ChordPro (using the user's SongSelect login), opens
 * Chordless's /import-song in the tab named 'chordless' (reusing it if open),
 * waits for CHORDLESS_READY and posts CHORDLESS_IMPORT. See song-import.js.
 */
async function importFromSongSelect(chordlessUrl) {
  if (!window.location.href.includes('songselect.ccli.com')) {
    alert('Please navigate to a SongSelect song page first.')
    return
  }
  const urlMatch = window.location.href.match(/\/songs\/(\d+)/)
  if (!urlMatch) {
    alert('❌ Could not extract song number from URL')
    return
  }
  const songNumber = urlMatch[1]
  const title = document.querySelector('h1')?.textContent.trim()
  const keyMatch = document.body.textContent.match(/Key:\s*([A-G][b#]?)/i)
  const key = keyMatch ? keyMatch[1] : 'C'

  try {
    const response = await fetch(
      `https://songselect.ccli.com/api/GetSongChordPro?songNumber=${songNumber}&key=${key}&style=Number&columns=1`,
      { headers: { accept: '*/*', 'client-locale': 'en-GB' }, credentials: 'include' }
    )
    if (!response.ok) throw new Error(`API failed: ${response.status}`)
    const chordproText = (await response.json()).payload
    if (!chordproText?.trim()) throw new Error('Empty ChordPro file. Do you have access?')

    // Reuse the Chordless tab if there is one (Chordless pages set window.name)
    let tab = window.open('', 'chordless')
    if (!tab || tab.closed) {
      tab = window.open(`${chordlessUrl}/import-song`, 'chordless')
    } else {
      tab.location.href = `${chordlessUrl}/import-song`
    }
    if (!tab) {
      alert('⚠️ Popup blocked. Please allow popups.')
      return
    }

    const timeout = setTimeout(() => alert('⚠️ Timeout waiting for Chordless'), 10000)
    const onMessage = event => {
      if (event.origin !== chordlessUrl || event.data?.type !== 'CHORDLESS_READY') return
      clearTimeout(timeout)
      window.removeEventListener('message', onMessage)
      tab.postMessage(
        {
          type: 'CHORDLESS_IMPORT',
          data: {
            chordproText,
            metadata: { ccliNumber: songNumber, title, key },
            source: 'songselect',
          },
        },
        chordlessUrl
      )
    }
    window.addEventListener('message', onMessage)
  } catch (error) {
    alert(`❌ Import failed: ${error.message}`)
  }
}

/**
 * The bookmarklet as a javascript: URL that imports into the Chordless at
 * `origin`. Fully percent-encoded, so pasting it into a bookmark's URL field
 * keeps its line breaks.
 */
export function bookmarkletUrl(origin) {
  return `javascript:${encodeURIComponent(`(${importFromSongSelect})(${JSON.stringify(origin)})`)}`
}

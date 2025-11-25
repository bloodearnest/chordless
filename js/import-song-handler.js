// Import Song Handler for Chordless
// Handles bookmarklet imports with user choice UI

import { createSetlist, determineSetlistType, getCurrentDB, getNextSunday } from './db.js'
import { createSong, findExistingSong } from './song-utils.js'

;(async function () {
  'use strict'

  // Initialize database
  const db = await getCurrentDB()

  let pendingSong = null
  let duplicateChoice = null // 'update' or 'use-existing'

  // Listen for messages from the bookmarklet
  window.addEventListener('message', event => {
    // Verify origin (only accept from songselect)
    if (!event.origin.startsWith('https://songselect.ccli.com')) {
      return
    }

    // Check if it's a Chordless import message
    if (event.data && event.data.type === 'CHORDLESS_IMPORT') {
      console.log('[Import] Received import message from:', event.origin)
      processImport(event.data.data)
    }
  })

  // Signal to opener that we're ready to receive data
  function signalReady() {
    if (window.opener) {
      console.log('[Import] Page loaded, signaling ready to opener...')
      try {
        window.opener.postMessage(
          {
            type: 'CHORDLESS_READY',
          },
          'https://songselect.ccli.com'
        )
      } catch (e) {
        console.log('[Import] Could not signal opener:', e)
      }
    }
  }

  // Process the imported song
  async function processImport(importData) {
    const { chordproText, metadata, source } = importData

    console.log('[Import] Processing import from', source)
    console.log('[Import] Song:', metadata.title)
    console.log('[Import] ChordPro length:', chordproText.length)

    try {
      const ccliNumber = metadata.ccliNumber || null
      const title = metadata.title || 'Untitled'

      // Check if song already exists
      const existing = await findExistingSong(ccliNumber, title, db)

      if (existing) {
        console.log('[Import] Song already exists:', title)
        pendingSong = existing
        await showChoices(existing, existing)
        return
      }

      // Create new song using new model
      const song = await createSong(chordproText, {
        ccliNumber: ccliNumber,
        title: title,
        source: source,
        sourceUrl: null,
        versionLabel: 'Original (SongSelect)',
      })

      console.log('[Import] Created new song:', title)

      // Store pending song
      pendingSong = song

      // Show choices UI
      await showChoices(song, null)
    } catch (error) {
      console.error('[Import] Failed to process song:', error)
      showError(`Failed to process song: ${error.message}`)
    }
  }

  async function showChoices(song, existingSong) {
    const statusEl = document.getElementById('import-status')
    const choicesEl = document.getElementById('import-choices')
    const titleEl = document.getElementById('imported-song-title')
    const duplicateWarning = document.getElementById('duplicate-warning')
    const choicesContainer = document.querySelector('#import-choices > div:last-child')

    titleEl.textContent = `✅ ${song.title}`

    statusEl.style.display = 'none'
    choicesEl.style.display = 'block'

    // Setup all choice buttons
    setupChoiceButtons()

    // Handle duplicate scenario
    if (existingSong) {
      duplicateWarning.style.display = 'block'
      choicesContainer.style.display = 'none'

      // Setup duplicate choice buttons
      const updateBtn = document.getElementById('duplicate-update')
      const useExistingBtn = document.getElementById('duplicate-use-existing')

      updateBtn.onclick = () => {
        duplicateChoice = 'update'
        duplicateWarning.style.display = 'none'
        choicesContainer.style.display = 'flex'
      }

      useExistingBtn.onclick = () => {
        duplicateChoice = 'use-existing'
        // Don't save the new song, just use existing
        duplicateWarning.style.display = 'none'
        choicesContainer.style.display = 'flex'
      }
    }
  }

  async function setupChoiceButtons() {
    // Load most recent setlists (up to 3)
    const setlists = await db.getAllSetlists()
    if (setlists.length > 0) {
      // Sort by date descending
      setlists.sort((a, b) => b.date.localeCompare(a.date))
      const recentSetlists = setlists.slice(0, 3)

      const select = document.getElementById('recent-setlist-select')
      const recentButton = document.getElementById('choice-recent-setlist')

      // Populate dropdown
      select.innerHTML = ''
      recentSetlists.forEach(setlist => {
        const option = document.createElement('option')
        option.value = setlist.id
        const formattedDate = formatDate(setlist.date)
        option.textContent = setlist.name ? `${formattedDate} - ${setlist.name}` : formattedDate
        select.appendChild(option)
      })

      recentButton.style.display = 'flex'

      recentButton.onclick = async e => {
        // Don't trigger if clicking on the select itself
        if (e.target.tagName === 'SELECT') {
          return
        }
        const selectedId = select.value
        await saveSongAndAddToSetlist(selectedId)
      }
    }

    // Setup button handlers
    document.getElementById('choice-new-setlist').onclick = () => {
      openCreateSetlistModal()
    }

    document.getElementById('choice-library-only').onclick = async () => {
      await saveSongOnly()
    }
  }

  async function saveSongAndAddToSetlist(setlistId) {
    try {
      // Song is already saved to per-org DB when created/found
      console.log('[Import] Using song:', pendingSong.id)

      // Load setlist
      const setlist = await db.getSetlist(setlistId)
      if (!setlist) {
        throw new Error('Setlist not found')
      }

      // Add song to setlist using new schema
      const newSongEntry = {
        order: setlist.songs.length,
        songId: pendingSong.id,
        songUuid: pendingSong.uuid,
        key: null,
        tempo: null,
        notes: '',
      }

      setlist.songs.push(newSongEntry)
      setlist.modifiedDate = new Date().toISOString()

      await db.saveSetlist(setlist)

      console.log('[Import] Added song to setlist:', setlistId)

      // Navigate to setlist
      window.location.href = `/setlist/${setlistId}`
    } catch (error) {
      console.error('[Import] Error:', error)
      showError(`Failed to save song: ${error.message}`)
    }
  }

  async function saveSongOnly() {
    try {
      // Song is already saved to per-org DB when created/found
      console.log('[Import] Song in library:', pendingSong.uuid)

      // Get title from song (need to import song-utils to get full song)
      const { getSongWithContent } = await import('./song-utils.js')
      const fullSong = await getSongWithContent(pendingSong.uuid)

      if (duplicateChoice !== 'use-existing') {
        alert(`✅ Saved "${fullSong.title}" to song library!`)
      } else {
        alert(`✅ Song "${fullSong.title}" is already in your library!`)
      }

      // Navigate to the specific song in the library
      window.location.href = `/songs#${pendingSong.uuid}`
    } catch (error) {
      console.error('[Import] Error:', error)
      showError(`Failed to save song: ${error.message}`)
    }
  }

  function openCreateSetlistModal() {
    const modal = document.getElementById('create-setlist-modal')
    const form = document.getElementById('create-setlist-form')

    // Set default date to next Sunday
    const nextSunday = getNextSunday()
    document.getElementById('setlist-date').valueAsDate = nextSunday

    // Set default type based on date
    const defaultType = determineSetlistType(nextSunday.toISOString().split('T')[0], '')
    document.getElementById('setlist-type').value = defaultType

    // Clear other fields
    document.getElementById('setlist-time').value = '10:30'
    document.getElementById('setlist-name').value = ''
    document.getElementById('setlist-leader').value = ''

    modal.classList.add('active')

    // Handle form submission
    form.onsubmit = async e => {
      e.preventDefault()

      const formData = new FormData(form)
      const date = formData.get('date')
      const time = formData.get('time')
      const type = formData.get('type')
      const name = formData.get('name')
      const leader = formData.get('leader')

      // Create setlist
      const setlist = createSetlist({ date, time, type, name, leader })

      try {
        // Save setlist to database
        await db.saveSetlist(setlist)
        console.log('[Import] Created new setlist:', setlist.id)

        // Close modal
        modal.classList.remove('active')

        // Add song to this new setlist
        await saveSongAndAddToSetlist(setlist.id)
      } catch (error) {
        console.error('[Import] Error creating setlist:', error)
        alert(`Failed to create setlist: ${error.message}`)
      }
    }

    // Handle close buttons
    document.getElementById('create-modal-close').onclick = () => {
      modal.classList.remove('active')
    }

    document.getElementById('create-cancel').onclick = () => {
      modal.classList.remove('active')
    }

    modal.onclick = e => {
      if (e.target === modal) {
        modal.classList.remove('active')
      }
    }
  }

  function showError(message) {
    const statusEl = document.getElementById('import-status')
    statusEl.innerHTML = `<p style="text-align: center; color: #e74c3c;">❌ ${message}</p>`
    statusEl.style.display = 'block'
    document.getElementById('import-choices').style.display = 'none'
  }

  function formatDate(dateString) {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', signalReady)
  } else {
    signalReady()
  }
})()

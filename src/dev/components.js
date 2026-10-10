// Sample song data for testing
const sampleSongs = [
  {
    id: 'song-1',
    title: 'How Great Thou Art',
    artist: 'Words by Stuart Wesley Keene Hine | Music: Swedish Folk Melody',
    ccliNumber: '14181',
    metadata: {
      key: 'A',
      tempo: 110,
      timeSignature: '4/4',
    },
    lastUsedAt: '2025-10-20T10:30:00Z',
  },
  {
    id: 'song-2',
    title: 'Amazing Grace',
    artist: 'John Newton',
    ccliNumber: '22025',
    metadata: {
      key: 'G',
      tempo: 90,
      timeSignature: '3/4',
    },
    lastUsedAt: '2025-10-13T14:00:00Z',
  },
  {
    id: 'song-3',
    title: 'Cornerstone',
    artist: 'Hillsong Worship',
    ccliNumber: '6158927',
    metadata: {
      key: 'C',
      tempo: 73,
      timeSignature: '4/4',
    },
    lastUsedAt: '2025-10-06T11:00:00Z',
  },
  {
    id: 'song-4',
    title: 'Ancient Hymn',
    artist: null,
    ccliNumber: '123456',
    metadata: {
      key: 'D',
      tempo: 120,
      timeSignature: '4/4',
    },
    lastUsedAt: '2025-09-28T10:00:00Z',
  },
  {
    id: 'song-5',
    title: 'Blessed Be Your Name',
    artist: 'Matt Redman, Beth Redman',
    ccliNumber: '3798438',
    metadata: {
      key: 'B',
      tempo: 130,
      timeSignature: '4/4',
    },
    lastUsedAt: '2025-09-15T09:30:00Z',
  },
  {
    id: 'song-6',
    title: "How Deep The Father's Love",
    artist: 'Stuart Townend, Keith Getty, Kristyn Getty, John Smith, Another Person',
    ccliNumber: '1558110',
    metadata: {
      key: 'D',
      tempo: 68,
      timeSignature: '3/4',
    },
    lastUsedAt: '2024-12-20T10:00:00Z',
  },
  {
    id: 'song-7',
    title: 'Simple Song',
    artist: 'Unknown',
    ccliNumber: null,
    metadata: {
      key: null,
      tempo: null,
      timeSignature: null,
    },
    lastUsedAt: null,
  },
]

// Import the components
import '/components/song-card.ts'
import '/components/app-header.ts'

let libraryEditMode = false
let setlistEditMode = false
let songToDelete = null
let deleteContext = null

// Modal elements
const modal = document.getElementById('delete-modal')
const modalTitle = document.getElementById('modal-title')
const modalMessage = document.getElementById('modal-message')
const modalCancel = document.getElementById('modal-cancel')
const modalConfirm = document.getElementById('modal-confirm')

function showDeleteModal(song, context) {
  songToDelete = song
  deleteContext = context

  if (context === 'setlist') {
    modalTitle.textContent = 'Remove from Setlist?'
    modalMessage.textContent = `Remove "${song.title}" from this setlist? The song will remain in your library.`
  } else {
    modalTitle.textContent = 'Delete Song?'
    modalMessage.textContent = `Permanently delete "${song.title}" from your library? This will also remove it from all setlists. This cannot be undone.`
  }

  modal.classList.add('active')
}

function hideDeleteModal() {
  modal.classList.remove('active')
  songToDelete = null
  deleteContext = null
}

function deleteSong() {
  if (songToDelete) {
    console.log(`Deleting song from ${deleteContext}:`, songToDelete.title)
    // In the real app, this would call the appropriate delete function
    // For now, just remove from the test list
    const index = sampleSongs.findIndex(s => s.id === songToDelete.id)
    if (index !== -1) {
      sampleSongs.splice(index, 1)
      renderLibraryCards()
      renderSetlistCards()
    }
  }
  hideDeleteModal()
}

function renderLibraryCards() {
  const container = document.getElementById('library-list')
  container.textContent = ''

  for (const song of sampleSongs) {
    const card = document.createElement('song-card')
    card.song = song
    card.variant = 'library'
    card.editMode = libraryEditMode

    // Add event listeners
    card.addEventListener('song-click', e => {
      console.log('Library - Song clicked:', e.detail.song.title)
    })

    card.addEventListener('song-delete', e => {
      console.log('Library - Song delete clicked:', e.detail.song.title)
      showDeleteModal(e.detail.song, 'library')
    })

    container.appendChild(card)
  }
}

function renderSetlistCards() {
  const container = document.getElementById('setlist-list')
  container.textContent = ''

  for (const song of sampleSongs) {
    const card = document.createElement('song-card')
    card.song = song
    card.variant = 'setlist'
    card.editMode = setlistEditMode

    // Add event listeners
    card.addEventListener('song-click', e => {
      console.log('Setlist - Song clicked:', e.detail.song.title)
    })

    card.addEventListener('song-delete', e => {
      console.log('Setlist - Song delete clicked:', e.detail.song.title)
      showDeleteModal(e.detail.song, 'setlist')
    })

    container.appendChild(card)
  }
}

// Wait for components to be defined, then render
customElements.whenDefined('song-card').then(() => {
  renderLibraryCards()
  renderSetlistCards()

  // Set up library edit mode toggle
  document.getElementById('library-edit-toggle').addEventListener('click', () => {
    libraryEditMode = !libraryEditMode
    renderLibraryCards()
  })

  // Set up setlist edit mode toggle
  document.getElementById('setlist-edit-toggle').addEventListener('click', () => {
    setlistEditMode = !setlistEditMode
    renderSetlistCards()
  })

  // Set up app-header test interactions
  const overviewHeader = document.getElementById('overview-header')
  const songHeader = document.getElementById('song-header')

  document.getElementById('header-overview-edit-toggle').addEventListener('click', () => {
    overviewHeader.editMode = !overviewHeader.editMode
  })

  document.getElementById('header-song-edit-toggle').addEventListener('click', () => {
    songHeader.editMode = !songHeader.editMode
  })

  // Listen to header events
  document.addEventListener('nav-menu-click', () => {
    console.log('Nav menu clicked')
  })

  document.addEventListener('edit-mode-toggle', e => {
    console.log('Edit mode toggled on:', e.target.title)
  })

  document.addEventListener('info-click', e => {
    console.log('Info clicked on:', e.target.title)
  })

  // Set up modal buttons
  modalCancel.addEventListener('click', hideDeleteModal)
  modalConfirm.addEventListener('click', deleteSong)

  // Close modal on background click
  modal.addEventListener('click', e => {
    if (e.target === modal) {
      hideDeleteModal()
    }
  })
})

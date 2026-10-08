// Create Setlist Modal Handler
import { createSetlist, determineSetlistType, getCurrentDB, getNextSunday } from './db.js'
import { getOrganisationPeople } from './people.js'
import { toLocalDateString } from './utils/date-utils.js'

let db = null

// Initialize the database
async function initDB() {
  if (!db) {
    db = await getCurrentDB()
  }
  return db
}

// Initialize the modal
export async function initCreateSetlistModal() {
  await initDB()

  const modal = document.getElementById('create-setlist-modal')
  const createButton = document.getElementById('create-setlist-button')
  const form = document.getElementById('create-setlist-form')

  if (!modal || !createButton || !form) {
    console.error('Create setlist modal elements not found')
    return
  }

  // Open with defaults: next Sunday, a Sunday morning service, led by you
  createButton.addEventListener('click', async () => {
    const { people, me } = await getOrganisationPeople()
    const date = toLocalDateString(getNextSunday())
    form.people = people
    form.setlist = {
      date,
      time: '10:30',
      type: determineSetlistType(date, ''),
      name: '',
      owner: me?.name || '',
      ownerId: me?.id || '',
    }
    modal.show()
  })

  form.addEventListener('cancel', () => modal.close())

  form.addEventListener('save', async event => {
    try {
      const newSetlist = createSetlist(event.detail)
      await db.saveSetlist(newSetlist)
      console.log('Setlist created:', newSetlist)
      modal.close()
      window.location.href = `/setlist/${newSetlist.id}`
    } catch (error) {
      console.error('Failed to create setlist:', error)
      alert('Failed to create setlist: ' + error.message)
    }
  })
}

// Initialize nav menu button
async function initNavMenuButton() {
  // Wait for custom element to be defined
  await customElements.whenDefined('nav-menu')

  const navMenuButton = document.getElementById('nav-menu-button')
  const navMenu = document.getElementById('nav-menu')

  if (navMenuButton && navMenu) {
    // Set the trigger button for positioning
    navMenu.setTriggerButton(navMenuButton)

    navMenuButton.addEventListener('click', () => {
      navMenu.togglePopover()
    })
  }
}

// Auto-initialize if we're on the home page
if (document.getElementById('create-setlist-modal')) {
  initCreateSetlistModal()
  initNavMenuButton()
}

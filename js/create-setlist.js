// Create Setlist Modal Handler
import { SetalightDB, getNextSunday, determineSetlistType, createSetlist } from './db.js';

let db = null;

// Initialize the database
async function initDB() {
    if (!db) {
        db = new SetalightDB();
        await db.init();
    }
    return db;
}

// Initialize the modal
export async function initCreateSetlistModal() {
    await initDB();

    const modal = document.getElementById('create-setlist-modal');
    const createButton = document.getElementById('create-setlist-button');
    const closeButton = document.getElementById('create-modal-close');
    const cancelButton = document.getElementById('create-cancel');
    const form = document.getElementById('create-setlist-form');
    const dateInput = document.getElementById('setlist-date');
    const typeSelect = document.getElementById('setlist-type');
    const nameInput = document.getElementById('setlist-name');

    if (!modal || !createButton || !form) {
        console.error('Create setlist modal elements not found');
        return;
    }

    // Show modal and initialize form
    createButton.addEventListener('click', () => {
        // Set default date to next Sunday
        const nextSunday = getNextSunday();
        const dateString = nextSunday.toISOString().split('T')[0];
        dateInput.value = dateString;

        // Set default type to Church Service
        typeSelect.value = 'Church Service';

        // Clear optional fields
        nameInput.value = '';
        document.getElementById('setlist-leader').value = '';

        modal.classList.add('active');
    });

    // Close modal handlers
    const closeModal = () => {
        modal.classList.remove('active');
    };

    closeButton.addEventListener('click', closeModal);
    cancelButton.addEventListener('click', closeModal);

    // Close on overlay click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });

    // Auto-detect type when date or name changes
    const updateType = () => {
        const date = dateInput.value;
        const name = nameInput.value;
        if (date) {
            const detectedType = determineSetlistType(date, name);
            typeSelect.value = detectedType;
        }
    };

    dateInput.addEventListener('change', updateType);
    nameInput.addEventListener('input', updateType);

    // Handle form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = new FormData(form);
        const setlistData = {
            date: formData.get('date'),
            time: formData.get('time'),
            type: formData.get('type'),
            name: formData.get('name'),
            leader: formData.get('leader')
        };

        try {
            // Create the setlist
            const newSetlist = createSetlist(setlistData);

            // Save to database
            await db.saveSetlist(newSetlist);

            console.log('Setlist created:', newSetlist);

            // Close modal
            closeModal();

            // Redirect to the new setlist
            window.location.href = `/setlist/${newSetlist.id}`;
        } catch (error) {
            console.error('Failed to create setlist:', error);
            alert('Failed to create setlist: ' + error.message);
        }
    });
}

// Initialize nav menu button
async function initNavMenuButton() {
    // Wait for custom element to be defined
    await customElements.whenDefined('nav-menu');

    const navMenuButton = document.getElementById('nav-menu-button');
    const navMenu = document.getElementById('nav-menu');

    if (navMenuButton && navMenu) {
        // Set the trigger button for positioning
        navMenu.setTriggerButton(navMenuButton);

        navMenuButton.addEventListener('click', () => {
            navMenu.togglePopover();
        });
    }
}

// Auto-initialize if we're on the home page
if (document.getElementById('create-setlist-modal')) {
    initCreateSetlistModal();
    initNavMenuButton();
}

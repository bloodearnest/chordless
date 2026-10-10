import '/components/song-info-dialog.js'
import '/components/setlist-info-dialog.js'
import '/components/app-modal.js'

const weeksAgo = weeks => new Date(Date.now() - weeks * 7 * 86400000).toISOString().slice(0, 10)

const states = {
  full: {
    song: {
      title: 'How Great Thou Art',
      artist: 'Stuart K. Hine',
      ccliNumber: '14181',
      metadata: { key: 'A', tempo: 72, timeSignature: '3/4' },
    },
    appearances: [
      { date: weeksAgo(2), playedInKey: 'G', leader: 'Ann', setlistName: '' },
      { date: weeksAgo(9), playedInKey: 'A', leader: 'Ben', setlistName: 'Harvest' },
      { date: weeksAgo(30), playedInKey: 'A', leader: 'Ann', setlistName: '' },
    ],
  },
  long: {
    song: {
      title:
        'O Come All Ye Faithful (Adeste Fideles) – Extended Arrangement With Descant And Final Verse',
      metadata: { key: 'G' },
    },
    appearances: [],
  },
  minimal: { song: { title: 'Untitled Song', metadata: {} }, appearances: [] },
  loading: { song: { title: 'Loading Song' }, loading: true },
  missing: { song: null },
}

const setlists = {
  full: {
    date: '2026-10-11',
    time: '10:30',
    type: 'Church Service',
    name: 'Harvest',
    owner: 'Ann',
    songs: [{}, {}, {}, {}, {}],
    createdDate: '2026-09-30T19:12:00Z',
    modifiedDate: '2026-10-07T08:45:00Z',
  },
  minimal: { date: '2026-10-14', songs: [] },
}
const setlistDialog = document.getElementById('setlist-dialog')
for (const button of document.querySelectorAll('[data-setlist]')) {
  button.addEventListener('click', () => setlistDialog.show(setlists[button.dataset.setlist]))
}
document
  .getElementById('edit-setlist')
  .addEventListener('click', () => setlistDialog.edit(setlists.full))
// Stand in for the setlist page: apply the changes and show the result
setlistDialog.addEventListener('details-save', event => {
  Object.assign(setlists.full, event.detail.changes, { modifiedDate: new Date().toISOString() })
  setlistDialog.show(setlists.full)
})

const dialog = document.getElementById('dialog')
for (const button of document.querySelectorAll('[data-state]')) {
  button.addEventListener('click', () => {
    const state = button.dataset.state
    if (state === 'no-heading') {
      document.getElementById('plain-modal').show()
    } else {
      dialog.showData(states[state])
    }
  })
}

import '/components/media-player.ts'
import '/components/media-player-settings.ts'

const player = document.getElementById('player')
const state = {
  key: 'C',
  tempo: 120,
  tempoNote: '1/4',
  timeSignature: '4/4',
  counter: 0,
}

const keys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const keyButtonContainer = document.getElementById('key-buttons')
keys.forEach(key => {
  const button = document.createElement('button')
  button.textContent = key
  button.addEventListener('click', () => {
    document.querySelectorAll('#key-buttons button').forEach(b => {
      b.classList.remove('active')
    })
    button.classList.add('active')
    state.key = key
    sendSongChange()
  })
  if (key === state.key) {
    button.classList.add('active')
  }
  keyButtonContainer.appendChild(button)
})

const tempoPresets = [
  { bpm: 60, time: '4/4', tempoNote: '1/4', label: '60 · 4/4' },
  { bpm: 80, time: '3/4', tempoNote: '1/4', label: '80 · 3/4' },
  { bpm: 100, time: '6/8', tempoNote: '1/4', label: '100 · 6/8' },
  { bpm: 120, time: '4/4', tempoNote: '1/8', label: '120 · 4/4 (1/8 feel)' },
  { bpm: 152, time: '4/4', tempoNote: '1/8', label: '152 · 4/4 (1/8)' },
  { bpm: 90, time: '3/4', tempoNote: '1/8', label: '90 · 3/4 (1/8)' },
  { bpm: 72, time: '6/8', tempoNote: '3/8', label: '72 · 6/8 (3/8)' },
]

const tempoButtonContainer = document.getElementById('tempo-buttons')
tempoPresets.forEach(preset => {
  const button = document.createElement('button')
  button.textContent = preset.label
  button.addEventListener('click', () => {
    document.querySelectorAll('#tempo-buttons button').forEach(b => {
      b.classList.remove('active')
    })
    button.classList.add('active')
    state.tempo = preset.bpm
    state.timeSignature = preset.time
    state.tempoNote = preset.tempoNote || '1/4'
    sendSongChange()
  })
  if (preset.bpm === state.tempo && preset.time === state.timeSignature) {
    button.classList.add('active')
  }
  tempoButtonContainer.appendChild(button)
})

function sendSongChange() {
  state.counter += 1
  const song = {
    songId: `demo-song-${state.counter}`,
    title: `Demo Song ${state.counter}`,
    metadata: {
      key: state.key,
      tempo: state.tempo,
      tempoNote: state.tempoNote,
      timeSignature: state.timeSignature,
    },
  }
  document.dispatchEvent(new CustomEvent('song-change', { detail: { song } }))
}

async function initSongFeed() {
  await customElements.whenDefined('media-player')
  sendSongChange()
}

initSongFeed()

player.addEventListener('play-state-change', e => {
  console.log('Player state changed:', e.detail)
})

import { editMessage } from '/js/copy-editor.ts'

const list = document.getElementById('messages')
const filter = document.getElementById('filter')
let messages = []

async function load() {
  const response = await fetch('/__copy', { headers: { 'x-chordless-copy': '1' } })
  const body = await response.json()
  if (!response.ok) {
    list.textContent = body.error ?? response.statusText
    return
  }
  messages = body.messages
  render()
}

function render() {
  const wanted = filter.value.trim().toLowerCase()
  list.replaceChildren(
    ...messages
      .filter(m => !wanted || `${m.id} ${m.source} ${m.comment}`.toLowerCase().includes(wanted))
      .map(m => {
        const item = document.createElement('li')
        const button = document.createElement('button')
        for (const [name, text] of [
          ['id', m.id],
          ['source', m.source],
          ['comment', m.comment],
        ]) {
          if (!text) continue
          const line = document.createElement('div')
          line.className = name
          line.textContent = text
          button.append(line)
        }
        button.addEventListener('click', async () => {
          if (await editMessage([m.id])) await load()
        })
        item.append(button)
        return item
      })
  )
}

filter.addEventListener('input', render)
await load()

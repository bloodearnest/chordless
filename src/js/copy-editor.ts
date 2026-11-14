/**
 * Dev only: change what the app says, in the app (docs/COPY.md). The dev server puts this script
 * on every page (vite-plugins/copy-editor.ts); a built app has no trace of it.
 *
 * Alt + right click on a message (or the tooltip, label or placeholder it is in) opens its source,
 * with the comment about it from the catalogue, to change. Saving rewrites src/text/en.ts, and the
 * page takes the new words without reloading, so a toast or a dialog stays where it is. Add
 * `?copy=keys` to the address to see the names of the messages in place of the words.
 *
 * It finds the message by what each `t()` said: the text, and the name it was said for (it cannot
 * tell two messages that say the same words apart, and offers both).
 */
import { setTextTap, TEXT_CHANGED, type TextArgs, t } from './text.ts'

const ENDPOINT = '/__copy'
const HEADERS = { 'x-chordless-copy': '1', 'Content-Type': 'application/json' }

/** How many different things the app has said that are remembered: the oldest are forgotten after it */
const REMEMBERED = 3000

interface Said {
  key: string
  args: TextArgs | undefined
}

/** What was said (the words that went on the page) and which messages said it */
const said = new Map<string, Said[]>()
const showKeys = new URLSearchParams(location.search).get('copy') === 'keys'

setTextTap((key, text, args) => {
  const shown = showKeys ? key : text
  const same = said.get(shown) ?? []
  said.delete(shown)
  said.set(shown, [...same.filter(each => each.key !== key), { key, args }])
  if (said.size > REMEMBERED) said.delete(said.keys().next().value as string)
  return shown
})

export interface Found {
  /** Where the words are: the text of this node, or this attribute of this element */
  node: Text | Element
  attribute?: string
  words: string
  messages: Said[]
}

const ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt']

/** The words around a click, from the thing clicked outwards (through shadow roots) */
function wordsAt(event: MouseEvent): Omit<Found, 'messages'>[] {
  const found: Omit<Found, 'messages'>[] = []
  for (const element of event.composedPath().slice(0, 8)) {
    if (!(element instanceof Element)) continue
    for (const attribute of ATTRIBUTES) {
      const words = element.getAttribute(attribute)?.trim()
      if (words) found.push({ node: element, attribute, words })
    }
    for (const node of element.childNodes) {
      const words = node.nodeType === Node.TEXT_NODE ? node.textContent?.trim() : ''
      if (words) found.push({ node: node as Text, words })
    }
  }
  return found
}

function findMessage(event: MouseEvent): Found | null {
  const around = wordsAt(event)
  for (const each of around) {
    const messages = said.get(each.words)
    if (messages) return { ...each, messages }
  }
  // (the words may be in a longer text, with others around them: the longest said that is in it)
  for (const each of around) {
    const inside = [...said.keys()]
      .filter(words => words.length > 3 && each.words.includes(words))
      .sort((a, b) => b.length - a.length)[0]
    const messages = inside ? said.get(inside) : undefined
    if (inside && messages) return { ...each, words: inside, messages }
  }
  return null
}

interface Entry {
  id: string
  comment: string
  source: string
}

async function listMessages(): Promise<Entry[]> {
  const response = await fetch(ENDPOINT, { headers: HEADERS })
  const body = (await response.json()) as { messages?: Entry[]; error?: string }
  if (!response.ok || !body.messages) throw new Error(body.error ?? response.statusText)
  return body.messages
}

async function saveMessage(id: string, source: string): Promise<void> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ id, source }),
  })
  const body = (await response.json()) as { error?: string }
  if (!response.ok) throw new Error(body.error ?? response.statusText)
}

/** The page has the new words: the catalogue module was hot reloaded (or it was not, and it is time to say so) */
function catalogueChanged(): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      window.removeEventListener(TEXT_CHANGED, done)
      resolve()
    }
    window.addEventListener(TEXT_CHANGED, done)
    setTimeout(done, 3000)
  })
}

/** Everything that draws from the messages draws again: the components, through their shadow roots */
function renderAgain(root: ParentNode = document): void {
  for (const element of root.querySelectorAll('*')) {
    if ('requestUpdate' in element) (element as { requestUpdate(): void }).requestUpdate()
    if (element.shadowRoot) renderAgain(element.shadowRoot)
  }
}

/** Where the old words were put on the page, put the new: what is in a toast or an attribute is not drawn again */
function patch(found: Found, message: Said): void {
  const now = t(message.key, message.args)
  if (found.attribute) {
    const element = found.node as Element
    element.setAttribute(found.attribute, now)
  } else if (found.node.textContent) {
    found.node.textContent = found.node.textContent.replace(found.words, now)
  }
}

const STYLE = `
  dialog.copy-editor { width: min(40rem, calc(100% - 2rem)); padding: 1.25rem; border: 1px solid #888;
    border-radius: 8px; font: 16px/1.4 system-ui, sans-serif; color: #111; background: #fff; }
  dialog.copy-editor::backdrop { background: rgb(0 0 0 / 0.4); }
  .copy-editor h2 { margin: 0 0 0.5rem; font-size: 1.1rem; }
  .copy-editor code, .copy-editor select { font: 0.9rem ui-monospace, monospace; }
  .copy-editor .comment { margin: 0.5rem 0; font-style: italic; white-space: pre-wrap; }
  .copy-editor .values { margin: 0.5rem 0; font-size: 0.9rem; color: #444; }
  .copy-editor textarea { box-sizing: border-box; width: 100%; min-height: 6rem; padding: 0.5rem;
    font: 1rem/1.4 ui-monospace, monospace; }
  .copy-editor .error { min-height: 1.4em; margin: 0.25rem 0; color: #b00020; }
  .copy-editor .buttons { display: flex; gap: 0.5rem; justify-content: flex-end; }
  .copy-editor button { padding: 0.5rem 1rem; font: inherit; }
`

/**
 * Open the editor for a message: one of `keys` (the picker is shown when there are several); `found`,
 * for a message in the page, is where to put the new words once they are saved. Resolves when it is closed.
 */
export async function editMessage(keys: string[], found?: Found): Promise<boolean> {
  let entries: Entry[]
  try {
    entries = (await listMessages()).filter(entry => keys.includes(entry.id))
  } catch (error) {
    console.error('[copy-editor]', error)
    return false
  }
  if (entries.length === 0) return false

  const dialog = document.createElement('dialog')
  dialog.className = 'copy-editor'
  dialog.innerHTML = `
    <style>${STYLE}</style>
    <form>
      <h2>Edit message</h2>
      <select aria-label="Message"></select>
      <p class="comment"></p>
      <p class="values"></p>
      <textarea aria-label="What it says" spellcheck="true"></textarea>
      <p class="error" role="alert"></p>
      <div class="buttons">
        <button type="button" class="cancel">Cancel</button>
        <button type="submit" class="save">Save</button>
      </div>
    </form>`
  const form = dialog.querySelector('form') as HTMLFormElement
  const select = dialog.querySelector('select') as HTMLSelectElement
  const comment = dialog.querySelector('.comment') as HTMLElement
  const values = dialog.querySelector('.values') as HTMLElement
  const text = dialog.querySelector('textarea') as HTMLTextAreaElement
  const error = dialog.querySelector('.error') as HTMLElement
  const save = dialog.querySelector('.save') as HTMLButtonElement

  for (const entry of entries) select.append(new Option(entry.id, entry.id))
  select.hidden = entries.length === 1
  const show = () => {
    const entry = entries.find(each => each.id === select.value) as Entry
    comment.textContent = entry.comment
    comment.hidden = !entry.comment
    const names = [...new Set([...entry.source.matchAll(/\$([A-Za-z][\w-]*)/g)].map(m => m[1]))]
    values.textContent = names.length
      ? `Values: ${names.map(name => `{ $${name} }`).join(', ')}`
      : ''
    values.hidden = names.length === 0
    text.value = entry.source
    error.textContent = ''
    // (the heading is the name: it is what to look for in the catalogue, or to tell someone)
    ;(dialog.querySelector('h2') as HTMLElement).textContent = `Edit message “${entry.id}”`
  }
  select.addEventListener('change', show)
  show()

  document.body.append(dialog)
  const closed = new Promise<boolean>(resolve => {
    let saved = false
    dialog.addEventListener('close', () => {
      dialog.remove()
      resolve(saved)
    })
    dialog.querySelector('.cancel')?.addEventListener('click', () => dialog.close())
    form.addEventListener('submit', async event => {
      event.preventDefault()
      save.disabled = true
      try {
        const id = select.value
        const changed = catalogueChanged()
        await saveMessage(id, text.value)
        await changed
        saved = true
        renderAgain()
        const message = found?.messages.find(each => each.key === id)
        if (found && message) patch(found, message)
        dialog.close()
      } catch (problem) {
        error.textContent = problem instanceof Error ? problem.message : String(problem)
      } finally {
        save.disabled = false
      }
    })
  })
  dialog.showModal()
  text.focus()
  return closed
}

window.addEventListener(
  'contextmenu',
  event => {
    if (!event.altKey) return
    const found = findMessage(event)
    if (!found) return
    event.preventDefault()
    event.stopImmediatePropagation()
    void editMessage(
      found.messages.map(message => message.key),
      found
    )
  },
  true
)

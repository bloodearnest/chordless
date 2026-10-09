import { expect } from '@esm-bundle/chai'
import { isInModalDialog, isTypingInField } from '../public/js/utils/keyboard.js'

const { describe, it, afterEach } = window

describe('isTypingInField', () => {
  let host

  afterEach(() => host?.remove())

  /** Dispatch a keydown from `target` and report what a document listener sees */
  function keydownFrom(target) {
    let result
    const listener = event => {
      result = { typing: isTypingInField(event), target: event.target }
    }
    document.addEventListener('keydown', listener)
    target.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, composed: true }))
    document.removeEventListener('keydown', listener)
    return result
  }

  function mount(html) {
    host = document.createElement('div')
    host.innerHTML = html
    document.body.appendChild(host)
    return host.firstElementChild
  }

  it('is true for text inputs, textareas, selects and contenteditable', () => {
    for (const html of [
      '<input>',
      '<input type="text">',
      '<input type="date">',
      '<textarea></textarea>',
      '<select></select>',
      '<div contenteditable="true"></div>',
    ]) {
      expect(keydownFrom(mount(html)).typing, html).to.equal(true)
      host.remove()
    }
  })

  it('is false for buttons, checkboxes and the page itself', () => {
    expect(keydownFrom(mount('<button>Go</button>')).typing).to.equal(false)
    host.remove()
    expect(keydownFrom(mount('<input type="checkbox">')).typing).to.equal(false)
    host.remove()
    expect(keydownFrom(document.body).typing).to.equal(false)
  })

  it('sees a field inside shadow DOM, where event.target is the host', () => {
    const outer = mount('<div></div>')
    const input = document.createElement('input')
    outer.attachShadow({ mode: 'open' }).appendChild(input)

    const seen = keydownFrom(input)

    expect(seen.target).to.equal(outer) // what the old checks looked at
    expect(seen.typing).to.equal(true)
  })
})

describe('isInModalDialog', () => {
  let dialog

  afterEach(() => dialog?.remove())

  /** Whether a document listener sees a keydown from `target` as in a modal */
  function inModal(target) {
    let result
    const listener = event => {
      result = isInModalDialog(event)
    }
    document.addEventListener('keydown', listener)
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })
    )
    document.removeEventListener('keydown', listener)
    return result
  }

  it('is true inside a dialog shown with showModal, even within shadow DOM', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    dialog = host
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = '<dialog><button>OK</button></dialog>'
    root.querySelector('dialog').showModal()
    expect(inModal(root.querySelector('button'))).to.equal(true)
  })

  it('is false in a dialog shown without showModal, and outside dialogs', () => {
    dialog = document.createElement('dialog')
    dialog.innerHTML = '<button>OK</button>'
    document.body.appendChild(dialog)
    dialog.show()
    expect(inModal(dialog.querySelector('button'))).to.equal(false)
    expect(inModal(document.body)).to.equal(false)
  })
})

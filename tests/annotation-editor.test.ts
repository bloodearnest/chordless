import { expect, fixture, html } from '@open-wc/testing'
import '../src/components/annotation-editor.ts'
import type {
  AnnotationEditor,
  AnnotationEditorRequest,
} from '../src/components/annotation-editor.ts'

const { describe, it } = window

const request = (set: Partial<AnnotationEditorRequest> = {}): AnnotationEditorRequest => ({
  anchorElement: document.body,
  about: '“grace”',
  text: '',
  kind: { scope: 'setlist', reach: 'private' },
  canShare: true,
  isNew: true,
  ...set,
})

describe('annotation-editor', () => {
  async function open(set: Partial<AnnotationEditorRequest> = {}) {
    const editor = await fixture<AnnotationEditor>(html`<annotation-editor></annotation-editor>`)
    const answer = editor.edit(request(set))
    await editor.updateComplete
    const root = editor.shadowRoot as ShadowRoot
    await new Promise(resolve => requestAnimationFrame(resolve))
    const dialog = root.querySelector('dialog') as HTMLDialogElement
    const text = root.querySelector('textarea') as HTMLTextAreaElement
    const radio = (label: string) =>
      Array.from(root.querySelectorAll<HTMLLabelElement>('label'))
        .find(each => each.textContent?.trim() === label)
        ?.querySelector('input') as HTMLInputElement
    const button = (label: string) =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
        each => each.textContent?.trim() === label
      )
    return { editor, answer, dialog, text, radio, button }
  }

  const type = (text: HTMLTextAreaElement, value: string) => {
    text.value = value
    text.dispatchEvent(new Event('input'))
  }

  it('opens on a new annotation for this setlist and just the user, and answers with what was written', async () => {
    const { answer, dialog, text, radio, button } = await open()
    expect(dialog.open).to.equal(true)
    expect(dialog.getAttribute('aria-label')).to.equal('Annotation')
    expect(radio('This setlist').checked).to.equal(true)
    expect(radio('Just me').checked).to.equal(true)
    expect(button('Delete')).to.equal(undefined)
    type(text, '  softly ')
    button('Done')?.click()
    expect(await answer).to.deep.equal({
      action: 'save',
      text: 'softly',
      kind: { scope: 'setlist', reach: 'private' },
    })
    expect(dialog.open).to.equal(false)
  })

  it('answers with null when cancelled or dismissed', async () => {
    const first = await open()
    first.button('Cancel')?.click()
    expect(await first.answer).to.equal(null)
    const second = await open()
    second.dialog.close()
    expect(await second.answer).to.equal(null)
  })

  it('edits an existing annotation as it is, and can delete it', async () => {
    const { answer, text, radio, button } = await open({
      isNew: false,
      text: 'repeat 4×',
      kind: { scope: 'setlist', reach: 'shared' },
    })
    expect(text.value).to.equal('repeat 4×')
    expect(radio('The team').checked).to.equal(true)
    button('Delete')?.click()
    expect(await answer).to.deep.equal({ action: 'delete' })
  })

  it('shares only for those who can, and only a annotation for this setlist', async () => {
    const reader = await open({ canShare: false })
    expect(reader.radio('The team').disabled).to.equal(true)
    expect(reader.dialog.textContent).to.contain('Only people who can edit the setlist')
    reader.button('Cancel')?.click()

    const writer = await open()
    expect(writer.radio('The team').disabled).to.equal(false)
    writer.radio('The team').click()
    await writer.editor.updateComplete
    expect(writer.radio('The team').checked).to.equal(true)
    // For the song, it is the user's own again, and cannot be shared
    writer.radio('Always, this song').click()
    await writer.editor.updateComplete
    expect(writer.radio('Just me').checked).to.equal(true)
    expect(writer.radio('The team').disabled).to.equal(true)
    writer.button('Done')?.click()
    expect(await writer.answer).to.deep.equal({
      action: 'save',
      text: '',
      kind: { scope: 'song', reach: 'private' },
    })
  })

  it('saves with Ctrl+Enter, and a second request replaces the first (which is answered null)', async () => {
    const { editor, answer, text } = await open()
    type(text, 'drop out')
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    expect(await answer).to.deep.include({ action: 'save', text: 'drop out' })
    const later = editor.edit(request())
    const latest = editor.edit(request({ text: 'again' }))
    expect(await later).to.equal(null)
    await editor.updateComplete
    ;((editor.shadowRoot as ShadowRoot).querySelector('dialog') as HTMLDialogElement).close()
    expect(await latest).to.equal(null)
  })

  describe('where it opens', () => {
    const screen = (width: number, height: number) => {
      const was = [window.innerWidth, window.innerHeight]
      Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
      Object.defineProperty(window, 'innerHeight', { value: height, configurable: true })
      return () => {
        Object.defineProperty(window, 'innerWidth', { value: was[0], configurable: true })
        Object.defineProperty(window, 'innerHeight', { value: was[1], configurable: true })
      }
    }
    const beside = (top: number) => {
      const target = document.createElement('div')
      target.style.cssText = `position: fixed; left: 30px; top: ${top}px; width: 40px; height: 20px`
      document.body.append(target)
      return target
    }

    it('is at the top of a narrow screen, clear of the keyboard', async () => {
      const restore = screen(500, 700)
      try {
        const { dialog, button } = await open({ anchorElement: beside(400) })
        expect(dialog.style.top).to.equal('3rem')
        button('Cancel')?.click()
      } finally {
        restore()
      }
    })

    it('is under what was pressed on a wide screen, or over it if there is no room under', async () => {
      const restore = screen(1200, 2000)
      const low = beside(1900)
      const high = beside(100)
      try {
        const under = await open({ anchorElement: high })
        expect(Number.parseFloat(under.dialog.style.top)).to.be.closeTo(126, 1)
        under.button('Cancel')?.click()
        const over = await open({ anchorElement: low })
        expect(Number.parseFloat(over.dialog.style.top)).to.be.lessThan(1900)
        over.button('Cancel')?.click()
      } finally {
        restore()
        low.remove()
        high.remove()
      }
    })
  })
})

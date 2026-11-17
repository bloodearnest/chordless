/**
 * A message with tags in it (js/rich-text.ts): what a tag becomes, what is not a tag, and that a value
 * given to a message is never read as one.
 */
import { expect, fixture } from '@open-wc/testing'
import { html } from 'lit'
import { rich } from '../src/js/rich-text.ts'
import { setCatalogue } from '../src/js/text.ts'
import catalogue from '../src/text/en.ts'

const { describe, it, afterEach } = window

describe('rich', () => {
  afterEach(() => setCatalogue(catalogue))

  const render = async (key: string, args: Record<string, string> | undefined = undefined) => {
    const element = await fixture<HTMLElement>(
      html`<p>${rich(key, args, { go: words => html`<a href="/x">${words}</a>`, em: words => html`<em>${words}</em>` })}</p>`
    )
    return element
  }

  it('puts what each tag becomes where it is, with the text round it', async () => {
    setCatalogue('m = Not connected. <go>Connect it</go> on the page, <em>now</em>.')
    const element = await render('m')
    expect(element.textContent).to.equal('Not connected. Connect it on the page, now.')
    expect(element.querySelector('a')?.getAttribute('href')).to.equal('/x')
    expect(element.querySelector('a')?.textContent).to.equal('Connect it')
    expect(element.querySelector('em')?.textContent).to.equal('now')
  })

  it('shows the words of a tag it was not given, and any other angle bracket, as they are', async () => {
    setCatalogue('m = <odd>words</odd> and 1 < 2')
    const element = await render('m')
    expect(element.textContent).to.equal('words and 1 < 2')
    expect(element.querySelector('odd')).to.equal(null)
  })

  it('does not read a value given to the message as a tag', async () => {
    setCatalogue('m = The space { $name } is <go>here</go>.')
    const element = await render('m', { name: '<em>Loud</em>' })
    expect(element.textContent).to.equal('The space <em>Loud</em> is here.')
    expect(element.querySelector('em')).to.equal(null)
  })

  it('says a message with no tags as it is', async () => {
    setCatalogue('m = Just words')
    expect((await render('m')).textContent).to.equal('Just words')
  })
})

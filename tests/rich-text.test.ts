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

  const render = async (
    key: string,
    args: Record<string, string | number> | undefined = undefined
  ) => {
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

  it('says a message that starts and ends with a tag, and one that comes out empty', async () => {
    setCatalogue('m = <go>All of it</go>\nempty = { $nothing }')
    const element = await render('m')
    expect(element.textContent).to.equal('All of it')
    expect(element.querySelector('a')?.textContent).to.equal('All of it')
    expect((await render('empty', { nothing: '' })).textContent).to.equal('')
  })

  it('gives a number to the message as a number', async () => {
    setCatalogue(
      'm =\n    { $n ->\n        [one] One song\n       *[other] { $n } songs\n    }, <go>see</go>'
    )
    expect((await render('m', { n: 3 })).textContent).to.equal('3 songs, see')
  })
})

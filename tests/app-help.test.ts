import { expect, fixture, html } from '@open-wc/testing'
import type { AppHelp } from '../src/components/app-help.ts'
import type { HelpPage } from '../src/js/help-content.ts'
import '../src/components/app-help.ts'

const { describe, it, afterEach } = window

describe('app-help', () => {
  afterEach(() => {
    document.documentElement.style.colorScheme = ''
  })

  it('shows nothing without a page', async () => {
    const el = await fixture<AppHelp>(html`<app-help></app-help>`)
    expect(el.shadowRoot?.querySelector('section')).to.equal(null)
  })

  const page: HelpPage = {
    title: 'Test',
    intro: ['What it is.', 'And more.'],
    sections: [
      {
        heading: 'First',
        intro: 'About it',
        items: [
          { image: 'header-edit', label: 'Edit', text: 'Edits.' },
          { image: 'song-settings', wide: true, label: 'Settings', text: 'A panel.' },
          { label: 'Swipe', text: 'Go.' },
        ],
      },
      { heading: 'Only a heading' },
    ],
  }

  it('shows each section with its intro, and each item as its name and what it does', async () => {
    const el = await fixture<AppHelp>(html`<app-help .page=${page}></app-help>`)
    expect(el.shadowRoot?.querySelectorAll('.lead').length).to.equal(2)
    const sections = el.shadowRoot?.querySelectorAll('section') ?? []
    expect(sections.length).to.equal(2)
    expect(sections[0].querySelector('.intro')?.textContent).to.equal('About it')
    const items = sections[0].querySelectorAll('.item')
    expect(items.length).to.equal(3)
    expect(items[0].querySelector('.name')?.textContent).to.equal('Edit')
    expect(items[0].querySelector('.text')?.textContent).to.equal('Edits.')
    expect(sections[1].querySelector('.intro')).to.equal(null)
    expect(sections[1].querySelector('.item')).to.equal(null)
  })

  it('turns [text](/path) in what an item says into a link inside the app', async () => {
    const linked: HelpPage = {
      title: 'Test',
      intro: [],
      sections: [
        {
          heading: 'H',
          items: [
            { label: 'L', text: 'Turn it off in [Preferences](/preferences), or [here](/songs).' },
          ],
        },
      ],
    }
    const el = await fixture<AppHelp>(html`<app-help .page=${linked}></app-help>`)
    const links = [...(el.shadowRoot?.querySelectorAll('.text a') ?? [])]
    expect(links.map(link => link.getAttribute('href'))).to.deep.equal(['/preferences', '/songs'])
    expect(links.map(link => link.textContent)).to.deep.equal(['Preferences', 'here'])
    expect(el.shadowRoot?.querySelector('.text')?.textContent).to.equal(
      'Turn it off in Preferences, or here.'
    )
  })

  it('puts a small picture by the name, a wide one under it, and none for a gesture', async () => {
    const el = await fixture<AppHelp>(html`<app-help .page=${page}></app-help>`)
    const [small, wide, plain] = el.shadowRoot?.querySelectorAll('.item') ?? []
    expect(small.querySelector('.control .picture')).to.not.equal(null)
    expect(wide.querySelector('.control .picture')).to.equal(null)
    expect(wide.querySelector('.picture.wide')).to.not.equal(null)
    expect(plain.querySelector('.picture')).to.equal(null)
  })

  it('shows the picture for the theme in use, and the size it was taken at halved', async () => {
    const src = async () => {
      const el = await fixture<AppHelp>(html`<app-help .page=${page}></app-help>`)
      return el.shadowRoot?.querySelector<HTMLImageElement>('.picture')
    }
    expect((await src())?.getAttribute('src')).to.equal('/help/header-edit.png')
    document.documentElement.style.colorScheme = 'dark'
    const image = await src()
    expect(image?.getAttribute('src')).to.equal('/help/header-edit-dark.png')

    // Sized once it has loaded; a picture that is not there is left out
    Object.defineProperty(image, 'naturalWidth', { value: 200 })
    image?.dispatchEvent(new Event('load'))
    expect(image?.style.width).to.equal('100px')
    image?.dispatchEvent(new Event('error'))
    expect(image?.hidden).to.equal(true)
  })
})

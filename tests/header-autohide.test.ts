import { expect } from '@open-wc/testing'
import { autohideHeader } from '../src/js/setlist/header-autohide.ts'

describe('autohideHeader', () => {
  let root: HTMLElement
  let header: HTMLElement & { tucked: boolean }
  let section: HTMLElement
  let container: HTMLElement
  let abort: AbortController
  let phone: boolean
  let shown: boolean
  let realMatchMedia: typeof window.matchMedia
  let onMediaChange: (() => void) | undefined

  /** Scroll the section to a place, and let the page see it */
  const scrollTo = (top: number) => {
    section.scrollTop = top
    section.dispatchEvent(new Event('scroll'))
  }

  beforeEach(() => {
    root = document.createElement('div')
    container = document.createElement('div')
    container.className = 'song-container'
    section = document.createElement('div')
    section.className = 'section'
    section.style.cssText = 'height: 100px; overflow: auto'
    const content = document.createElement('div')
    content.style.height = '5000px'
    section.append(content)
    container.append(section)
    header = document.createElement('div') as unknown as HTMLElement & { tucked: boolean }
    header.style.height = '50px'
    header.tucked = false
    root.append(header, container)
    document.body.append(root)

    phone = true
    shown = true
    onMediaChange = undefined
    realMatchMedia = window.matchMedia
    window.matchMedia = (() => ({
      get matches() {
        return phone
      },
      addEventListener: (_type: string, listener: () => void) => {
        onMediaChange = listener
      },
    })) as unknown as typeof window.matchMedia

    abort = new AbortController()
    autohideHeader({
      header: header as never,
      root,
      songShown: () => shown,
      signal: abort.signal,
    })
  })

  afterEach(() => {
    abort.abort()
    root.remove()
    window.matchMedia = realMatchMedia
  })

  it('moves the header away with the scrolling, and back as it scrolls up', () => {
    scrollTo(20)
    expect(header.style.marginTop).to.equal('-20px')
    expect(root.style.getPropertyValue('--tuck')).to.equal('20px')
    expect(header.tucked).to.equal(false)
    scrollTo(50)
    expect(header.style.marginTop).to.equal('-50px')
    expect(header.tucked).to.equal(true)
    // (no further than its own height)
    scrollTo(200)
    expect(header.style.marginTop).to.equal('-50px')
    scrollTo(180)
    expect(header.style.marginTop).to.equal('-30px')
    expect(header.tucked).to.equal(false)
    scrollTo(160)
    expect(header.style.marginTop).to.equal('-10px')
  })

  it('has the header all there at the top of the page', () => {
    scrollTo(200)
    scrollTo(0)
    expect(header.style.marginTop).to.equal('')
    expect(root.style.getPropertyValue('--tuck')).to.equal('0px')
  })

  it('shows the header again for a swipe to another song', () => {
    scrollTo(200)
    expect(header.tucked).to.equal(true)
    container.dispatchEvent(new Event('scroll'))
    expect(header.tucked).to.equal(false)
  })

  it('does not tuck the header away on the overview', () => {
    shown = false
    scrollTo(200)
    expect(header.tucked).to.equal(false)
  })

  it('does not tuck the header away on a wider screen', () => {
    phone = false
    scrollTo(200)
    expect(header.tucked).to.equal(false)
  })

  it('shows the header when the screen widens', () => {
    scrollTo(200)
    expect(header.tucked).to.equal(true)
    onMediaChange?.()
    expect(header.tucked).to.equal(false)
  })

  it('shows the header when the page goes', () => {
    scrollTo(200)
    abort.abort()
    expect(header.tucked).to.equal(false)
  })

  it('takes no notice of scrolling that is not a song', () => {
    const other = document.createElement('div')
    root.append(other)
    other.dispatchEvent(new Event('scroll'))
    expect(header.tucked).to.equal(false)
  })
})

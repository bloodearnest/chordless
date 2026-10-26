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
  let realNow: typeof performance.now
  let now: number
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
    now = 1000
    onMediaChange = undefined
    realMatchMedia = window.matchMedia
    realNow = performance.now
    performance.now = () => now
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
    performance.now = realNow
  })

  it('tucks the header away scrolling down, and brings it back scrolling up', () => {
    scrollTo(100)
    scrollTo(200)
    expect(header.tucked).to.equal(true)
    expect(header.style.getPropertyValue('--tuck')).to.equal('50px')
    now += 400
    scrollTo(150)
    expect(header.tucked).to.equal(false)
  })

  it('ignores a small movement', () => {
    scrollTo(200)
    scrollTo(206)
    expect(header.tucked).to.equal(false)
  })

  it('keeps the header while the page is still within its height', () => {
    scrollTo(10)
    scrollTo(40)
    expect(header.tucked).to.equal(false)
  })

  it('leaves the scrolling alone while the header is moving', () => {
    scrollTo(100)
    scrollTo(200)
    expect(header.tucked).to.equal(true)
    // (the page's end moving under it: the pretend scroll up of the last moment)
    scrollTo(120)
    expect(header.tucked).to.equal(true)
  })

  it('shows the header again for a swipe to another song', () => {
    scrollTo(100)
    scrollTo(200)
    expect(header.tucked).to.equal(true)
    container.dispatchEvent(new Event('scroll'))
    expect(header.tucked).to.equal(false)
  })

  it('does not tuck the header away on the overview', () => {
    shown = false
    scrollTo(100)
    scrollTo(200)
    expect(header.tucked).to.equal(false)
  })

  it('does not tuck the header away on a wider screen', () => {
    phone = false
    scrollTo(100)
    scrollTo(200)
    expect(header.tucked).to.equal(false)
  })

  it('shows the header when the screen widens', () => {
    scrollTo(100)
    scrollTo(200)
    expect(header.tucked).to.equal(true)
    onMediaChange?.()
    expect(header.tucked).to.equal(false)
  })

  it('shows the header when the page goes', () => {
    scrollTo(100)
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

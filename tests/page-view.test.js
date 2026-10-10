import { expect } from '@open-wc/testing'
import { html } from 'lit'
import { PageView } from '../src/js/views/page-view.js'

const { describe, it, afterEach } = window

class ScrollingView extends PageView {
  render() {
    return html`
      <main style="height: 100px; overflow-y: auto">
        <div style="height: 1000px">tall</div>
      </main>
    `
  }
}
customElements.define('scrolling-view', ScrollingView)

describe('PageView keeps its scroll position', () => {
  let view

  afterEach(() => view?.remove())

  async function mount(restoredState) {
    view = document.createElement('scrolling-view')
    view.restoredState = restoredState
    document.body.append(view)
    await view.updateComplete
    return view
  }
  const frames = async count => {
    for (let i = 0; i < count; i++) await new Promise(resolve => requestAnimationFrame(resolve))
  }

  it('has no state to keep while it is at the top', async () => {
    await mount()
    expect(view.captureViewState()).to.equal(undefined)
  })

  it('captures how far its main is scrolled', async () => {
    await mount()
    view.querySelector('main').scrollTop = 250
    expect(view.captureViewState()).to.deep.equal({ scroll: 250 })
  })

  it('scrolls back to where it was left', async () => {
    await mount({ scroll: 300 })
    await frames(3)
    expect(view.querySelector('main').scrollTop).to.equal(300)
  })

  it('waits for what it shows to be tall enough', async () => {
    view = document.createElement('scrolling-view')
    view.restoredState = { scroll: 600 }
    document.body.append(view)
    await view.updateComplete
    const main = view.querySelector('main')
    // Content that arrives a few frames later
    main.firstElementChild.style.height = '50px'
    await frames(3)
    main.firstElementChild.style.height = '1000px'
    await frames(5)
    expect(main.scrollTop).to.equal(600)
  })

  it('starts at the top without a state', async () => {
    await mount()
    await frames(3)
    expect(view.querySelector('main').scrollTop).to.equal(0)
  })
})

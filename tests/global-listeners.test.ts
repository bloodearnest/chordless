import { expect } from '@esm-bundle/chai'
import { LitElement } from 'lit'
import { GlobalListeners } from '../src/js/global-listeners.ts'

const { describe, it } = window

class ListeningElement extends LitElement {
  calls = []
  listeners = new GlobalListeners(this)

  constructor() {
    super()
    this.listeners.add(document, 'test:ping', () => this.calls.push('document'))
    this.listeners.add(window, 'test:ping', () => this.calls.push('window'), { once: true })
  }

  override createRenderRoot() {
    return this
  }
}
customElements.define('listening-element', ListeningElement)

const ping = () => document.dispatchEvent(new Event('test:ping', { bubbles: true }))

describe('GlobalListeners', () => {
  it('listens while the element is connected', () => {
    const element = document.createElement('listening-element') as ListeningElement
    document.body.append(element)
    ping()
    expect(element.calls).to.deep.equal(['document', 'window'])
    element.remove()
  })

  it('stops listening when the element is removed', () => {
    const element = document.createElement('listening-element') as ListeningElement
    document.body.append(element)
    element.remove()
    ping()
    expect(element.calls).to.deep.equal([])
  })

  it('listens again when the element is reconnected, without doubling up', () => {
    const element = document.createElement('listening-element') as ListeningElement
    document.body.append(element)
    element.remove()
    document.body.append(element)
    ping()
    expect(element.calls).to.deep.equal(['document', 'window'])
    ping()
    expect(element.calls).to.deep.equal(['document', 'window', 'document'])
    element.remove()
  })

  it('listens straight away if added once the element is connected', () => {
    const element = document.createElement('listening-element') as ListeningElement
    document.body.append(element)
    element.listeners.add(document, 'test:late', () => element.calls.push('late'))
    document.dispatchEvent(new Event('test:late'))
    expect(element.calls).to.deep.equal(['late'])
    element.remove()
    document.dispatchEvent(new Event('test:late'))
    expect(element.calls).to.deep.equal(['late'])
  })
})

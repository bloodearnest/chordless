import { expect, fixture, html } from '@open-wc/testing'
import '../src/components/icon.ts'
import type { Icon } from '../src/components/icon.ts'

const { describe, it } = window

describe('app-icon', () => {
  it('draws the icon of the name, at the size', async () => {
    const icon = await fixture<Icon>(html`<app-icon name="check" size="28"></app-icon>`)
    const svg = icon.shadowRoot?.querySelector('svg')
    expect(svg).to.not.equal(null)
    expect(svg?.getAttribute('style')).to.equal('--icon-size: 28px')
  })

  it('leaves the size to the stylesheet when it is zero', async () => {
    const icon = await fixture<Icon>(html`<app-icon name="check" size="0"></app-icon>`)
    expect(icon.shadowRoot?.querySelector('svg')?.getAttribute('style')).to.equal('')
  })

  it('draws nothing, and says so in the console, for a name it does not have', async () => {
    const warn = console.warn
    const warnings: unknown[][] = []
    console.warn = (...args) => warnings.push(args)
    try {
      const icon = await fixture<Icon>(html`<app-icon name="no-such-icon"></app-icon>`)
      expect(icon.shadowRoot?.querySelector('svg')).to.equal(null)
    } finally {
      console.warn = warn
    }
    expect(String(warnings[0]?.[0])).to.contain('Unknown icon name: no-such-icon')
  })
})

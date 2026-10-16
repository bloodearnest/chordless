/**
 * The toast (js/toast.ts and components/app-toast.ts): what it shows and how it goes, that it
 * is above the page without taking the keys from it, and that it can be reached.
 */

import { expect } from '@open-wc/testing'
import type { AppToast } from '../src/components/app-toast.ts'
import { toast } from '../src/js/toast.ts'
import { A11Y, clearToasts, installFakeTimers, shownToast } from './test-helpers.ts'

const { describe, it, afterEach, beforeEach } = window

describe('toast', () => {
  let clock: ReturnType<typeof installFakeTimers>

  beforeEach(() => {
    clock = installFakeTimers()
  })

  afterEach(() => {
    clock.uninstall()
    clearToasts()
  })

  const element = () => document.querySelector('app-toast') as AppToast
  const inside = (selector: string) => element().shadowRoot?.querySelector<HTMLElement>(selector)
  const shown = async () => {
    await element().updateComplete
    return element().shadowRoot?.textContent?.replace(/\s+/g, ' ').trim()
  }

  it('shows the message, over the page, in the top layer', async () => {
    toast('Saved')
    expect(await shown()).to.contain('Saved')
    expect(element().matches(':popover-open')).to.equal(true)
    expect(element().popover).to.equal('manual')
  })

  it('is one element, used again', async () => {
    toast('One')
    toast('Two')
    expect(document.querySelectorAll('app-toast')).to.have.length(1)
    expect(await shown()).to.contain('Two')
    expect(await shown()).to.not.contain('One')
  })

  it('makes a new element when the old one has been taken from the page', async () => {
    toast('One')
    clearToasts()
    toast('Two')
    expect(document.querySelectorAll('app-toast')).to.have.length(1)
    expect(shownToast()?.message).to.equal('Two')
  })

  describe('an error', () => {
    it('is announced at once, and stays until it is dismissed', async () => {
      toast("Couldn't save.", { kind: 'error' })
      await shown()
      expect(inside('[role="alert"]')).to.not.equal(null)
      await clock.tick(60_000)
      expect(shownToast()?.message).to.equal("Couldn't save.")
    })

    it('has its reason behind Details', async () => {
      toast("Couldn't save.", { kind: 'error', details: 'disk full' })
      await shown()
      expect(inside('details summary')?.textContent).to.equal('Details')
      expect(inside('details p')?.textContent).to.equal('disk full')
      expect(inside('details')?.hasAttribute('open')).to.equal(false)
    })

    it('has no Details without a reason', async () => {
      toast("Couldn't save.", { kind: 'error' })
      await shown()
      expect(inside('details')).to.equal(null)
    })
  })

  describe('information', () => {
    it('is a status, and goes by itself after five seconds', async () => {
      toast('Saved')
      await shown()
      expect(inside('[role="status"]')).to.not.equal(null)
      await clock.tick(4900)
      expect(shownToast()).to.not.equal(null)
      await clock.tick(200)
      expect(shownToast()).to.equal(null)
    })

    it('goes five seconds after the last time it was shown', async () => {
      toast('Saved')
      await clock.tick(4000)
      toast('Saved again, with more')
      await clock.tick(4000)
      expect(shownToast()).to.not.equal(null)
      await clock.tick(1100)
      expect(shownToast()).to.equal(null)
    })

    it('does not take the five seconds from an error that replaces it', async () => {
      toast('Saved')
      toast("Couldn't save.", { kind: 'error' })
      await clock.tick(10_000)
      expect(shownToast()?.kind).to.equal('error')
    })
  })

  describe('the same message again', () => {
    it('counts up, rather than piling up', async () => {
      toast("Couldn't save.", { kind: 'error' })
      toast("Couldn't save.", { kind: 'error' })
      toast("Couldn't save.", { kind: 'error' })
      expect(await shown()).to.contain('×3')
      expect(document.querySelectorAll('app-toast')).to.have.length(1)
    })

    it('starts again at one for a different message, or the same one once it has gone', async () => {
      toast('One', { kind: 'error' })
      toast('One', { kind: 'error' })
      toast('Two', { kind: 'error' })
      expect(await shown()).to.not.contain('×')
      element().dismiss()
      toast('Two', { kind: 'error' })
      expect(await shown()).to.not.contain('×')
    })
  })

  describe('dismissing', () => {
    it('is done by the button, which has a name and a big enough target', async () => {
      toast("Couldn't save.", { kind: 'error' })
      await shown()
      const close = inside('button.close') as HTMLButtonElement
      expect(close.getAttribute('aria-label')).to.equal('Dismiss')
      const { width, height } = close.getBoundingClientRect()
      expect(Math.min(width, height)).to.be.at.least(40)

      close.click()

      expect(shownToast()).to.equal(null)
    })

    it('can be done with nothing showing', () => {
      toast('Saved')
      element().dismiss()
      expect(() => element().dismiss()).to.not.throw()
    })
  })

  describe('an action', () => {
    it('is a button that does it, and dismisses the toast', async () => {
      let ran = 0
      toast("Couldn't add the song.", {
        kind: 'error',
        action: { label: 'Try again', run: () => ran++ },
      })
      await shown()
      const button = inside('button.btn') as HTMLButtonElement
      expect(button.textContent?.trim()).to.equal('Try again')

      button.click()

      expect(ran).to.equal(1)
      expect(shownToast()).to.equal(null)
    })

    it('is not left over for the next message', async () => {
      toast('One', { kind: 'error', action: { label: 'Try again', run: () => {} } })
      toast('Two', { kind: 'error' })
      await shown()
      expect(inside('button.btn')).to.equal(null)
    })
  })

  describe('the page under it', () => {
    it('keeps the keys: it takes no focus, and a key press goes on to the page', async () => {
      const before = document.activeElement
      let pressed = 0
      const count = () => pressed++
      document.addEventListener('keydown', count)
      try {
        toast("Couldn't save.", { kind: 'error' })
        await shown()
        expect(document.activeElement).to.equal(before)
        document.body.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
        )
      } finally {
        document.removeEventListener('keydown', count)
      }
      expect(pressed).to.equal(1)
      expect(shownToast()).to.not.equal(null)
    })

    it('is on top of a dialog opened before it, and again when shown after one opened since', async () => {
      const dialog = document.createElement('dialog')
      document.body.append(dialog)
      dialog.showModal()
      try {
        toast("Couldn't save.", { kind: 'error' })
        const bottom = element().getBoundingClientRect().bottom
        expect(element().matches(':popover-open')).to.equal(true)
        expect(bottom).to.be.at.most(window.innerHeight)
      } finally {
        dialog.close()
        dialog.remove()
      }
    })
  })

  it('is accessible, with a reason and an action', async () => {
    clock.uninstall() // (the accessibility check waits on real timers)
    toast("Couldn't save.", {
      kind: 'error',
      details: 'disk full',
      action: { label: 'Try again', run: () => {} },
    })
    await element().updateComplete
    // (axe reads the colours mid-slide as faded, so it waits for the transition to end)
    await new Promise(resolve => setTimeout(resolve, 300))
    await expect(element()).to.be.accessible(A11Y)
  })
})

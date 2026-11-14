/**
 * Saying a message (js/text.ts) in the browser: its values, a value it was not given, a message there
 * is none of, and the dev editor's tap on what is said.
 */
import { expect } from '@open-wc/testing'
import { setTextTap, t } from '../src/js/text.ts'

describe('t', () => {
  afterEach(() => setTextTap(null))

  it('puts the values in the message', () => {
    expect(t('toast-setlist-moved', { title: 'Sunday', space: 'Church' })).to.equal(
      'Moved Sunday to Church.'
    )
  })

  it('says what it can of a message given no values, and says so', () => {
    const logged: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => void logged.push(args)
    try {
      expect(t('toast-setlist-deleted')).to.be.a('string')
    } finally {
      console.error = original
    }
    expect(logged).to.have.length(1)
  })

  it('shows the name of a message there is none of, and says so', () => {
    const logged: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => void logged.push(args)
    try {
      expect(t('no-such-message')).to.equal('no-such-message')
    } finally {
      console.error = original
    }
    expect(logged).to.have.length(1)
  })

  it('lets the dev editor see what is said, and change it', () => {
    const seen: string[] = []
    setTextTap((key, text, args) => {
      seen.push(`${key}:${JSON.stringify(args)}`)
      return `[${text}]`
    })
    expect(t('toast-setlist-deleted', { title: 'A' })).to.equal('[Deleted A.]')
    expect(seen).to.deep.equal(['toast-setlist-deleted:{"title":"A"}'])
  })
})

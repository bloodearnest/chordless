import { expect } from '@open-wc/testing'
import {
  announceSetlistsPulled,
  listenForPulledSetlists,
  SetlistsPulledEvent,
} from '../src/js/pulled-setlists.ts'
import { wait } from './test-helpers.ts'

const { describe, it } = window

/** The ids of the events sent on window while `work` runs */
async function heard(work: () => void | Promise<void>): Promise<string[][]> {
  const seen: string[][] = []
  const listener = (event: SetlistsPulledEvent) => seen.push(event.ids)
  window.addEventListener(SetlistsPulledEvent.type, listener)
  try {
    await work()
    await wait(50)
  } finally {
    window.removeEventListener(SetlistsPulledEvent.type, listener)
  }
  return seen
}

describe('Telling the pages that a sync saved setlists', () => {
  it('sends the ids on window, and nothing when there are none', async () => {
    expect(await heard(() => announceSetlistsPulled(['a', 'b']))).to.deep.equal([['a', 'b']])
    expect(await heard(() => announceSetlistsPulled([]))).to.deep.equal([])
  })

  it('passes on what another tab announced, and ignores anything else on the channel', async () => {
    listenForPulledSetlists()
    const other = new BroadcastChannel('chordless-setlists-pulled')
    const seen = await heard(() => {
      other.postMessage(['from-another-tab'])
      other.postMessage('not a list of ids')
    })
    other.close()
    expect(seen).to.deep.equal([['from-another-tab']])
  })
})

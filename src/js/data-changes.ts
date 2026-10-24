/**
 * The change bus (docs/STATE.md): every committed write to the space's database says so, once,
 * from the database, whoever made it. What shows or sends the data listens: the sync by itself
 * sends what was changed here, and a page that shows a record reads it again when another writer
 * (a sync, another tab) changed it. Sent on `window`, and on a BroadcastChannel to the app's
 * other tabs, which send it on their own `window` with `remote` set.
 */

/** The kinds of stored record a change is about */
export type DataKind = 'setlist' | 'song' | 'chart'

/** Where a change came from: made here by the user (so it may need sending), or by a sync (it came from storage) */
export type DataOrigin = 'local' | 'sync'

export interface DataChange {
  /** The space whose database was written */
  spaceId: string
  kind: DataKind
  /** The records written or deleted; null for all of that kind (cleared, or every link let go) */
  ids: string[] | null
  origin: DataOrigin
  /** It was made by another tab of the app */
  remote: boolean
}

/** A write to the database was committed (sent on window) */
export class DataChangeEvent extends Event {
  static readonly type = 'data:change'
  readonly change: DataChange
  constructor(change: DataChange) {
    super(DataChangeEvent.type)
    this.change = change
  }
}

declare global {
  interface WindowEventMap {
    [DataChangeEvent.type]: DataChangeEvent
  }
}

const CHANNEL = 'chordless-data-changes'

/** Which tab this is: a channel delivers to every other channel object of the name, including this page's own */
const TAB = crypto.randomUUID()

/** What goes over the channel: the change, and the tab that made it */
interface TabMessage {
  tab: string
  change: Omit<DataChange, 'remote'>
}

/** Whether a change touches this record (a change of all of the kind touches every one) */
export function touches(change: DataChange, kind: DataKind, id?: string): boolean {
  if (change.kind !== kind) return false
  return id === undefined || change.ids === null || change.ids.includes(id)
}

/** Tell this page, and the app's other tabs, that a write was committed */
export function announceDataChange(change: Omit<DataChange, 'remote'>): void {
  window.dispatchEvent(new DataChangeEvent({ ...change, remote: false }))
  const channel = new BroadcastChannel(CHANNEL)
  channel.postMessage({ tab: TAB, change } satisfies TabMessage)
  channel.close()
}

let listening = false

/** Hear of the writes other tabs made, as changes with `remote` set */
export function listenForOtherTabs(): void {
  if (listening) return
  listening = true
  new BroadcastChannel(CHANNEL).addEventListener('message', event => {
    const message = event.data as TabMessage | null
    const change = message?.change
    if (message?.tab === TAB) return
    if (change && typeof change.spaceId === 'string' && typeof change.kind === 'string') {
      window.dispatchEvent(new DataChangeEvent({ ...change, remote: true }))
    }
  })
}

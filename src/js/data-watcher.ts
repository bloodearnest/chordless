/**
 * What a page that shows stored records does about a change to them (docs/STATE.md): runs a
 * function, once the writes have stopped for a moment, when a write of a kind it shows was
 * committed in the space in use, by whoever (the page itself, a sync, another tab). A page is then
 * one declaration of what it shows, not a load plus a refresh wired to each writer.
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit'
import { type DataChange, DataChangeEvent, type DataKind } from './data-changes.ts'
import { getCurrentSpace } from './space.ts'

/** A sync saves a song and its chart one after the other: they are one change to a page */
export const QUIET_MS = 150

class DataWatcher implements ReactiveController {
  #kinds: DataKind[]
  #onChange: (changes: DataChange[]) => void
  #quietMs: number
  #pending: DataChange[] = []
  #timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    host: ReactiveControllerHost,
    kinds: DataKind[],
    onChange: (changes: DataChange[]) => void,
    quietMs = QUIET_MS
  ) {
    this.#kinds = kinds
    this.#onChange = onChange
    this.#quietMs = quietMs
    host.addController(this)
  }

  hostConnected(): void {
    window.addEventListener(DataChangeEvent.type, this.#heard)
  }

  hostDisconnected(): void {
    window.removeEventListener(DataChangeEvent.type, this.#heard)
    clearTimeout(this.#timer)
    this.#pending = []
  }

  #heard = ({ change }: DataChangeEvent): void => {
    if (!this.#kinds.includes(change.kind)) return
    const { id } = getCurrentSpace()
    if (id && change.spaceId !== id) return
    this.#pending.push(change)
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      const changes = this.#pending
      this.#pending = []
      this.#onChange(changes)
    }, this.#quietMs)
  }
}

/** Run `onChange` when writes of these kinds are committed in the space in use (the host's life is the watch's) */
export function watchData(
  host: ReactiveControllerHost,
  kinds: DataKind[],
  onChange: (changes: DataChange[]) => void,
  quietMs?: number
): void {
  new DataWatcher(host, kinds, onChange, quietMs)
}

import { css, html, LitElement, nothing } from 'lit'
import type { SongRecord } from '../js/data-types.ts'
import type { ChordlessDB } from '../js/db.ts'
import { getCurrentDB } from '../js/db.ts'
import { describeOrigin } from '../js/song-source.ts'
import {
  deleteOnlyVersion,
  deleteVariant,
  linkSong,
  makeDefault,
  renameVariant,
  setlistsUsing,
  variantsOf,
} from '../js/song-versions.ts'
import { toast } from '../js/toast.ts'
import { errorMessage } from '../js/utils/errors.ts'
import { buttonStyles } from './shared-styles.ts'

/** The versions of a song were changed: the page showing the song may have to look again */
export class SongVersionsChangedEvent extends Event {
  static readonly type = 'song-versions:changed'
  /** The song itself is gone (its only version was deleted), so the page showing it cannot stay */
  readonly songDeleted: boolean
  constructor(songDeleted = false) {
    super(SongVersionsChangedEvent.type, { bubbles: true, composed: true })
    this.songDeleted = songDeleted
  }
}

/**
 * The versions of a song: each variant with who imported it and when, which is the default, and
 * what to do with it (make it the default, rename it, delete it after a second tap). Another song
 * can be merged into this one as a variant of it.
 *
 * Usage:
 *   <song-versions .songId=${song.id}></song-versions>   (the current space's database, or `db`)
 *
 * Events:
 * @fires SongVersionsChangedEvent after any change
 */
export class SongVersions extends LitElement {
  static override properties = {
    songId: { attribute: false },
    db: { attribute: false },
    _variants: { state: true },
    _others: { state: true },
    _renaming: { state: true },
    _deleting: { state: true },
    _usedIn: { state: true },
    _mergeFrom: { state: true },
  }

  declare songId: string
  declare db: ChordlessDB | null
  declare _variants: SongRecord[]
  /** The other songs of the library, to merge into this one: one record (the default) of each */
  declare _others: SongRecord[]
  /** The uuid of the variant being renamed, and of the one waiting to be deleted */
  declare _renaming: string | null
  declare _deleting: string | null
  /** How many setlists the song being deleted is in */
  declare _usedIn: number
  declare _mergeFrom: string

  static override styles = [
    buttonStyles,
    css`
      :host {
        display: block;
      }
      h3 {
        margin: 0 0 0.5rem;
        font-size: var(--font-ui);
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      li {
        padding: 0.6rem 0;
        border-bottom: 1px solid var(--border-color);
      }
      .label {
        font-weight: 600;
      }
      .default {
        margin-left: 0.5rem;
        padding: 0.05rem 0.5rem;
        border-radius: 1em;
        border: 1px solid var(--color-info);
        font-size: var(--font-ui-small);
      }
      .origin {
        font-size: var(--font-ui-small);
        color: var(--text-secondary);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-top: 0.4rem;
      }
      .actions .btn {
        font-size: var(--font-ui-small);
        padding: 0.3rem 0.7rem;
      }
      .confirm {
        margin-top: 0.4rem;
        font-size: var(--font-ui-small);
      }
      label {
        display: block;
        margin: 0.5rem 0;
        font-size: var(--font-ui-small);
      }
      input[type='text'],
      select {
        display: block;
        width: 100%;
        box-sizing: border-box;
        margin-top: 0.25rem;
        padding: 0.4rem 0.6rem;
        font: inherit;
        border: 2px solid var(--border-light);
        border-radius: 6px;
        background-color: var(--bg-secondary);
        color: var(--text-color);
      }
      details {
        margin-top: 1rem;
      }
      label.fill {
        display: flex;
        gap: 0.5rem;
        align-items: flex-start;
      }
    `,
  ]

  constructor() {
    super()
    this.songId = ''
    this.db = null
    this._variants = []
    this._others = []
    this._renaming = null
    this._deleting = null
    this._usedIn = 0
    this._mergeFrom = ''
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('songId') || changed.has('db')) void this._load()
  }

  async _database(): Promise<ChordlessDB> {
    return this.db ?? (await getCurrentDB())
  }

  async _load(): Promise<void> {
    try {
      const db = await this._database()
      this._variants = await variantsOf(db, this.songId)
      const songs = new Map<string, SongRecord>()
      for (const record of await db.getAllSongs()) {
        if (record.id === this.songId) continue
        if (record.isDefault || !songs.has(record.id)) songs.set(record.id, record)
      }
      this._others = [...songs.values()].sort((a, b) => a.title.localeCompare(b.title))
    } catch (error) {
      // (the versions are extra to what the page shows: without them it shows none)
      console.error('[SongVersions] Could not load the versions:', error)
      this._variants = []
      this._others = []
    }
    this._mergeFrom = ''
  }

  /** Run a change; say so (a toast) if it fails, look again, and tell the page */
  async _change(
    failure: string,
    change: (db: ChordlessDB) => Promise<void>,
    songDeleted = false
  ): Promise<void> {
    try {
      await change(await this._database())
    } catch (error) {
      console.error(`[SongVersions] ${failure}:`, error)
      toast(failure, { kind: 'error', details: errorMessage(error) })
      return
    }
    this._renaming = null
    this._deleting = null
    await this._load()
    this.dispatchEvent(new SongVersionsChangedEvent(songDeleted))
  }

  /** Ask to delete a version, once it is known how many setlists have it */
  async _askToDelete(variant: SongRecord): Promise<void> {
    this._usedIn = await setlistsUsing(await this._database(), variant.uuid)
    this._deleting = variant.uuid
  }

  _saveName(variant: SongRecord, event: Event): void {
    event.preventDefault()
    const input = (event.target as HTMLFormElement).elements.namedItem('name') as HTMLInputElement
    void this._change("Couldn't rename the version.", db =>
      renameVariant(db, variant.uuid, input.value).then(() => undefined)
    )
  }

  _merge(event: Event): void {
    event.preventDefault()
    const form = event.target as HTMLFormElement
    const label = (form.elements.namedItem('label') as HTMLInputElement).value
    const fillGaps = (form.elements.namedItem('fill') as HTMLInputElement).checked
    void this._change("Couldn't merge the songs.", db =>
      linkSong(db, this._mergeFrom, this.songId, label, { fillGaps })
    )
  }

  _renderVariant(variant: SongRecord) {
    const several = this._variants.length > 1
    const renaming = this._renaming === variant.uuid
    const deleting = this._deleting === variant.uuid
    return html`
      <li>
        <div>
          <span class="label">${variant.variantLabel || 'Original'}</span>
          ${variant.isDefault ? html`<span class="default">Default</span>` : nothing}
        </div>
        <div class="origin">
          ${describeOrigin(variant)}${variant.key ? `, key ${variant.key}` : ''}
        </div>
        ${
          renaming
            ? html`
              <form @submit=${(event: Event) => this._saveName(variant, event)}>
                <label>
                  Variant name
                  <input name="name" type="text" .value=${variant.variantLabel || ''} />
                </label>
                <div class="actions">
                  <button class="btn primary" type="submit">Save</button>
                  <button class="btn" type="button" @click=${() => {
                    this._renaming = null
                  }}>Cancel</button>
                </div>
              </form>
            `
            : html`
              <div class="actions">
                ${
                  variant.isDefault
                    ? nothing
                    : html`<button class="btn make-default" @click=${() =>
                        this._change("Couldn't make it the default.", db =>
                          makeDefault(db, variant.uuid)
                        )}>Make default</button>`
                }
                <button class="btn rename" @click=${() => {
                  this._renaming = variant.uuid
                }}>Rename</button>
                ${
                  deleting
                    ? nothing
                    : html`<button class="btn delete" @click=${() => this._askToDelete(variant)}>${several ? 'Delete' : 'Delete song'}</button>`
                }
              </div>
            `
        }
        ${
          deleting
            ? html`
              <div class="confirm" role="alert">
                ${
                  several
                    ? html`Delete this version? Setlists that use it will use
                      ${variant.isDefault ? 'the next version' : 'the default'} instead.`
                    : html`Delete this song?
                      ${
                        this._usedIn
                          ? `It is in ${this._usedIn} ${this._usedIn === 1 ? 'setlist' : 'setlists'} and will be taken out of ${this._usedIn === 1 ? 'it' : 'them'}, so it will no longer count as played there.`
                          : ''
                      }
                      It cannot be undone from here.`
                }
                <div class="actions">
                  <button class="btn primary confirm-delete" @click=${() =>
                    several
                      ? this._change("Couldn't delete the version.", db =>
                          deleteVariant(db, variant.uuid).then(() => undefined)
                        )
                      : this._change(
                          "Couldn't delete the song.",
                          db => deleteOnlyVersion(db, variant.uuid).then(() => undefined),
                          true
                        )}>${several ? 'Delete version' : 'Delete song'}</button>
                  <button class="btn" @click=${() => {
                    this._deleting = null
                  }}>Cancel</button>
                </div>
              </div>
            `
            : nothing
        }
      </li>
    `
  }

  override render() {
    if (!this._variants.length) return nothing
    return html`
      <section aria-labelledby="versions-heading">
        <h3 id="versions-heading">Versions</h3>
        <ul>${this._variants.map(variant => this._renderVariant(variant))}</ul>
        ${
          this._others.length
            ? html`
              <details>
                <summary>Merge another song into this one</summary>
                <form class="merge" @submit=${(event: Event) => this._merge(event)}>
                  <label>
                    The song to merge in
                    <select name="song" @change=${(event: Event) => {
                      this._mergeFrom = (event.target as HTMLSelectElement).value
                    }}>
                      <option value="">Choose a song</option>
                      ${this._others.map(
                        song =>
                          html`<option value=${song.id}>${song.title}${song.ccliNumber ? ` (${song.ccliNumber})` : ''}${song.variantLabel && song.variantLabel !== 'Original' ? ` — ${song.variantLabel}` : ''}</option>`
                      )}
                    </select>
                  </label>
                  <label>
                    Variant name
                    <input name="label" type="text" placeholder="Alternate" />
                  </label>
                  <label class="fill">
                    <input name="fill" type="checkbox" checked />
                    <span>
                      Fill in details one is missing (artist, copyright, tempo, time) from the other.
                      Details already there are never changed.
                    </span>
                  </label>
                  <button class="btn primary merge-button" type="submit" ?disabled=${!this._mergeFrom}>
                    Merge as a variant
                  </button>
                </form>
              </details>
            `
            : nothing
        }
      </section>
    `
  }
}

customElements.define('song-versions', SongVersions)

declare global {
  interface HTMLElementTagNameMap {
    'song-versions': SongVersions
  }
}

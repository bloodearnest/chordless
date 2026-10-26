/**
 * What the setlist page's header shows: the title, the song's key, capo and tempo (the metadata
 * display, the key and capo pickers, the settings popover), and the buttons that are the
 * setlist's (share, differs from official, live) with their dialogs. It shows what the page has
 * (the setlist, the song being viewed); what the header's controls do is the page's, which
 * listens to them (SetlistPage._listenToControls).
 */
import type { AppHeader } from '../../components/app-header.ts'
import type { CapoSelector } from '../../components/capo-selector.ts'
import type { KeySelector } from '../../components/key-selector.ts'
import type { MusicalMetadataDisplay } from '../../components/musical-metadata-display.ts'
import type { SetlistDiffers } from '../../components/setlist-differs.ts'
import type { SetlistShare } from '../../components/setlist-share.ts'
import type { SongSettingsPopover } from '../../components/song-settings-popover.ts'
import type { Setlist } from '../data-types.ts'
import type { ChordlessDB } from '../db.ts'
import { getLive, isLiveSetlist } from '../live.ts'
import { getLiveSyncStatus } from '../live-sync-status.ts'
import { wantsMediaPlayer } from '../media-player-loader.ts'
import { listPadSets } from '../pad-set-service.ts'
import { buildUrl, type Route } from '../router.ts'
import { getSongUserPrefs } from '../song-user-prefs.ts'
import { syncsBack } from '../space.ts'
import { differsFromOfficial } from '../sync/revert.ts'
import { getAvailableKeys } from '../transpose.ts'
import { normalizeCapo } from '../utils/capo.ts'
import { formatSetlistDate, setlistTitle } from '../utils/date-utils.ts'
import { sleep } from '../utils/sleep.ts'
import { isEditMode, setBodyEditMode } from './edit-mode-ui.ts'
import type { RuntimeSong } from './runtime-songs.ts'

/** What the header asks of the page it is in */
export interface HeaderHost {
  readonly root: HTMLElement
  readonly songs: RuntimeSong[]
  /** The song being viewed, -1 for the overview */
  readonly currentSongIndex: number
  readonly currentSetlist: Setlist | undefined
  readonly _capoEnabled: boolean
  _database(): ChordlessDB
  /** The route of a song of this setlist, or of its overview (-1) */
  _routeFor(songIndex: number): Route
}

/** How long the header's controls take to fade, as app-header has it */
const FADE_MS = 300

/** The tempo the settings show for a song that has none */
const DEFAULT_BPM = 120

export class SetlistHeader {
  host: HeaderHost
  /** The song the info button is for: null on the overview */
  songForInfo: RuntimeSong | null = null
  /** The key the capo picker last worked from, for a song with none of its own */
  #capoKey = ''

  constructor(host: HeaderHost) {
    this.host = host
  }

  #find<T extends HTMLElement>(selector: string): T | null {
    return this.host.root.querySelector<T>(selector)
  }

  /** The song being viewed, if one is */
  get #song(): RuntimeSong | null {
    const { songs, currentSongIndex } = this.host
    return currentSongIndex >= 0 ? (songs[currentSongIndex] ?? null) : null
  }

  /**
   * Show a song in the header (its title, key, capo and tempo), or the setlist's overview (null).
   * The controls fade out and back in unless `instant`.
   */
  async show(song: RuntimeSong | null, instant = false) {
    const appHeader = this.#find<AppHeader>('#app-header')
    const { currentSetlist } = this.host
    const title = song
      ? song.title
      : currentSetlist
        ? setlistTitle(currentSetlist, 'short')
        : 'Setlist'
    if (!appHeader) return

    // On a phone the overview's title is the date alone, and the name (or, with none, the type of
    // service) a row under it: the top row has little room
    const onOverview = !song && currentSetlist
    const phoneHeading = onOverview ? formatSetlistDate(currentSetlist.date, 'compact') : ''
    const subheading = onOverview ? currentSetlist.name || currentSetlist.type || '' : ''

    appHeader.showEditToggle = true
    // (nothing to change)
    if (
      appHeader.heading === title &&
      appHeader.phoneHeading === phoneHeading &&
      appHeader.subheading === subheading &&
      !instant
    ) {
      return
    }

    if (instant) {
      appHeader.phoneHeading = phoneHeading
      appHeader.subheading = subheading
      appHeader.setTitleInstant(title)
      this.#showContent(song)
    } else {
      appHeader.phoneHeading = phoneHeading
      appHeader.subheading = subheading
      appHeader.heading = title
      await this.#fadeControls(() => this.#showContent(song))
    }
  }

  #showContent(song: RuntimeSong | null) {
    const musicalMetadata = this.#find<MusicalMetadataDisplay>('#musical-metadata')
    const keySelector = this.#find<KeySelector>('#key-selector')
    const capoSelector = this.#find<CapoSelector>('#capo-selector')
    const { _capoEnabled: capoEnabled } = this.host

    if (song) {
      if (song.currentKey) {
        this.showKey(song.currentKey)
      } else if (keySelector) {
        keySelector.value = '-'
        keySelector.keys = []
      }
      if (capoSelector && capoEnabled) this.showCapo(song.currentCapo, song.currentKey)
      this.showSongSettings()
      if (musicalMetadata) {
        musicalMetadata.keyValue = song.currentKey || ''
        musicalMetadata.capoValue = capoEnabled ? (song.currentCapo ?? 0) : 0
        musicalMetadata.bpm = song.currentBPM || null
        musicalMetadata.timeSignature = song.metadata?.time || song.metadata?.timeSignature || ''
        musicalMetadata.style.display = ''
      }
      this.songForInfo = song
      this.showButtons(false)
    } else {
      // The overview: no song's metadata or key
      if (musicalMetadata) musicalMetadata.style.display = 'none'
      if (keySelector) {
        keySelector.value = '-'
        keySelector.keys = []
      }
      if (capoSelector) capoSelector.referenceKey = ''
      this.songForInfo = null
      this.showButtons(true)
    }
  }

  /** Fade the header's controls out, change them while they cannot be seen, and fade them in */
  async #fadeControls(change: () => void) {
    const controls = this.#find('.header-controls-slot')
    if (controls) controls.style.opacity = '0'
    await sleep(FADE_MS)
    change()
    // (a moment for the DOM to take the change)
    await sleep(10)
    if (controls) controls.style.opacity = '1'
  }

  /** Show new values in the song's metadata display (after a change to its key, capo or tempo) */
  showMetadata(shown: Partial<Pick<MusicalMetadataDisplay, 'keyValue' | 'capoValue' | 'bpm'>>) {
    const musicalMetadata = this.#find<MusicalMetadataDisplay>('#musical-metadata')
    if (musicalMetadata) Object.assign(musicalMetadata, shown)
  }

  /** The share, differs and live buttons: on the overview only. Share is lit while the setlist is shared */
  showButtons(show: boolean) {
    const { currentSetlist } = this.host
    const live = this.#find('#live-button')
    if (live) live.hidden = !show
    const differs = this.#find('#differs-button')
    if (differs) {
      differs.hidden = !(show && currentSetlist && differsFromOfficial(currentSetlist, syncsBack()))
    }
    const share = this.#find('#share-button')
    if (!share) return
    share.hidden = !show
    share.classList.toggle('shared', Boolean(currentSetlist?.share))
  }

  /** Where this setlist is live: its URL, and for a share its key, which is in the fragment */
  liveUrl(): string {
    const route = this.host._routeFor(-1)
    // biome-ignore lint/plugin: the share key is the link's fragment
    return buildUrl(route) + (route.name === 'share' ? location.hash : '')
  }

  /** The live button: red while this setlist is live, and what pressing it does */
  refreshLive() {
    const button = this.#find('#live-button')
    if (!button) return
    const live = getLive()
    const here = isLiveSetlist(live, buildUrl(this.host._routeFor(-1)))
    const label = here ? 'Leave live' : live ? 'Take over live here' : 'Go live'
    button.classList.toggle('live', here)
    button.setAttribute('aria-pressed', String(here))
    button.setAttribute('aria-label', label)
    button.title = label
    // (the dot: whether the other devices are reached at once, while this one is live on a team space)
    const sync = here ? getLiveSyncStatus() : null
    if (sync) button.dataset.sync = sync
    else delete button.dataset.sync
  }

  /** Hand the "differs from official" dialog the setlist */
  refreshDiffers() {
    const dialog = this.#find<SetlistDiffers>('#setlist-differs')
    const { currentSetlist } = this.host
    if (!dialog || !currentSetlist) return
    dialog.setlist = currentSetlist
    dialog.db = this.host._database()
  }

  /** Hand the share dialog the setlist */
  refreshShare() {
    const dialog = this.#find<SetlistShare>('#setlist-share')
    const { currentSetlist } = this.host
    if (!dialog || !currentSetlist) return
    dialog.setlist = currentSetlist
    dialog.db = this.host._database()
    dialog.songs = this.host.songs
    dialog.linkable = syncsBack()
  }

  /** Show a key in the key picker, with the keys around it and the song's original */
  showKey(key: string) {
    const keySelector = this.#find<KeySelector>('#key-selector')
    if (!keySelector) return
    keySelector.value = key
    keySelector.keys = getAvailableKeys(key)
    keySelector.originalKey = this.#song?.originalKey ?? ''
    keySelector.editMode = isEditMode()
  }

  /** Show the song being viewed's key in the key picker */
  showCurrentKey() {
    const key = this.#song?.currentKey
    if (key) this.showKey(key)
  }

  /** Show a capo in the capo picker (when the capo is on), against `key` or the last one shown */
  showCapo(value: unknown, key: string | null | undefined = null) {
    if (!this.host._capoEnabled) return
    const capoSelector = this.#find<CapoSelector>('#capo-selector')
    if (!capoSelector) return
    capoSelector.value = normalizeCapo(value)
    capoSelector.referenceKey = key || this.#capoKey || ''
    this.#capoKey = capoSelector.referenceKey
    capoSelector.editMode = isEditMode()
  }

  /** Show the capo picker if the capo is on, with the song being viewed's capo */
  showCurrentCapo() {
    const capoSelector = this.#find<CapoSelector>('#capo-selector')
    if (!capoSelector) return
    capoSelector.style.display = this.host._capoEnabled ? '' : 'none'
    if (!this.host._capoEnabled) return
    const song = this.#song
    this.showCapo(song?.currentCapo, song?.currentKey)
  }

  /** The capo was turned on or off: show the picker, or hide it */
  showCapoPreference() {
    const capoSelector = this.#find<CapoSelector>('#capo-selector')
    if (!capoSelector) return
    capoSelector.style.display = this.host._capoEnabled ? '' : 'none'
    const song = this.#song
    if (this.host._capoEnabled && song) this.showCapo(song.currentCapo, song.currentKey)
    else capoSelector.referenceKey = ''
  }

  /** The song settings popover, for the song being viewed: its tempo, and this user's pad choice */
  showSongSettings() {
    const popover = this.#find<SongSettingsPopover>('#song-settings-popover')
    const song = this.#song
    if (!popover || !song) return

    popover.bpmValue = song.currentBPM || DEFAULT_BPM
    // This user's media choices for the song (theirs alone: not in the setlist, so a user who
    // can only read it can make them too). Shown only where the media player is
    popover.mediaAvailable = wantsMediaPlayer()
    if (popover.mediaAvailable) {
      popover.padSetId = getSongUserPrefs(song.songId, this.host._database().spaceId)?.padSetId
      listPadSets()
        .then(sets => {
          popover.padSets = sets
        })
        .catch(error => console.warn('[SongSettings] Could not list the pad sets:', error))
    }
  }

  /** Edit mode was left: the header and its pickers say so at once (no fade) */
  leaveEditMode() {
    setBodyEditMode(false)
    const appHeader = this.#find<AppHeader>('#app-header')
    if (appHeader) appHeader.editMode = false
    const keySelector = this.#find<KeySelector>('#key-selector')
    if (keySelector) keySelector.editMode = false
    const capoSelector = this.#find<CapoSelector>('#capo-selector')
    if (capoSelector) capoSelector.editMode = false
  }
}

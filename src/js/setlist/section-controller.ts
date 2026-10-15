/**
 * How each part of each song of a setlist is shown (hidden, collapsed, chords only...): the
 * user's own choices in this setlist, then their choices for the song, then their defaults. Finds
 * the song-section elements, shows them, and keeps what is changed (through the page, which
 * saves it with the setlist's capos: see local-state.ts).
 */

import type { SongDisplay } from '../../components/song-display.ts'
import {
  SectionActionEvent,
  SectionToggleEvent,
  type SongSection,
} from '../../components/song-section.ts'
import type { HideMode, SectionState } from '../data-types.ts'
import { getSectionDefaults } from '../preferences.ts'
import { getSongUserPrefs } from '../song-user-prefs.ts'
import type { SectionStates } from './local-state.ts'
import type { RuntimeSong } from './runtime-songs.ts'
import { defaultHideMode, sectionLabel } from './section-defaults.ts'

/** What the controller asks of the page it is in */
export interface SectionHost {
  readonly root: HTMLElement
  readonly songs: RuntimeSong[]
  organisationId(): string
  /** Keep the section states (and the capos) on this device */
  saveState(): void
}

export class SectionController {
  host: SectionHost
  /** The states that differ from the defaults, by song index then section index */
  states: SectionStates = {}
  #actionHandler?: (event: SectionActionEvent) => void
  #toggleHandler?: (event: SectionToggleEvent) => void

  constructor(host: SectionHost) {
    this.host = host
  }

  applyAll(root: ParentNode = this.host.root) {
    const isEditMode = document.body.classList.contains('edit-mode')

    // Find all song-section elements, including those inside song-display shadow DOMs
    const sections: SongSection[] = []

    // First, get any song-sections directly in the root
    sections.push(...root.querySelectorAll('song-section'))

    // Then, query into song-display shadow roots
    const songDisplays = root.querySelectorAll('song-display')
    songDisplays.forEach(songDisplay => {
      if (songDisplay.shadowRoot) {
        sections.push(...songDisplay.shadowRoot.querySelectorAll('song-section'))
      }
    })

    sections.forEach(section => {
      const songIndex = Number(section.getAttribute('song-index'))
      const sectionIndex = Number(section.getAttribute('section-index'))
      if (Number.isNaN(songIndex) || Number.isNaN(sectionIndex)) {
        return
      }
      const state = this.resolve(songIndex, sectionIndex, section)
      // Apply state via reactive properties
      section.hideMode = state.hideMode
      section.isCollapsed = state.isCollapsed
      section.isHidden = state.isHidden
      section.editMode = isEditMode
    })
  }

  find(songIndex: number, sectionIndex: number): SongSection | null {
    // First try direct query (in case not in shadow DOM)
    let section: SongSection | null = this.host.root.querySelector<SongSection>(
      `song-section[song-index="${songIndex}"][section-index="${sectionIndex}"]`
    )
    if (section) return section

    // Query into song-display shadow roots
    const songDisplays = this.host.root.querySelectorAll<SongDisplay>('song-display')
    for (const songDisplay of songDisplays) {
      if (songDisplay.shadowRoot) {
        section = songDisplay.shadowRoot.querySelector<SongSection>(
          `song-section[song-index="${songIndex}"][section-index="${sectionIndex}"]`
        )
        if (section) return section
      }
    }

    return null
  }

  resolve(
    songIndex: number,
    sectionIndex: number,
    sectionElement: SongSection | null = null
  ): SectionState {
    // Priority 1: Setlist state override (explicit per-setlist override)
    const overridesForSong = this.states[songIndex] || {}
    const override = overridesForSong[sectionIndex] || null

    // Priority 2: Song user prefs (user's defaults for this song)
    const songUserPrefsDefaults = this.userDefaults(songIndex, sectionIndex)

    // Priority 3: Global section defaults & app defaults
    const appDefaults = {
      hideMode: this.defaultHideModeFor(sectionElement, songIndex, sectionIndex),
      isCollapsed: false,
      isHidden: false,
    }

    // Merge priorities, field by field
    return { ...appDefaults, ...songUserPrefsDefaults, ...override }
  }

  userDefaults(songIndex: number, sectionIndex: number): SectionState | null {
    // Get song user prefs for this song
    const song = this.host.songs?.[songIndex]
    if (!song) return null

    const songId = song.songId
    if (!songId) return null

    const prefs = getSongUserPrefs(songId, this.host.organisationId())
    if (!prefs?.sectionDefaults) return null

    return prefs.sectionDefaults[sectionIndex.toString()] || null
  }

  ensureOverride(
    songIndex: number,
    sectionIndex: number,
    sectionElement: SongSection | null = null
  ): SectionState {
    if (!this.states[songIndex]) {
      this.states[songIndex] = {}
    }
    if (!this.states[songIndex][sectionIndex]) {
      const resolved = this.resolve(songIndex, sectionIndex, sectionElement)
      this.states[songIndex][sectionIndex] = {
        hideMode: resolved.hideMode,
        isCollapsed: resolved.isCollapsed,
        isHidden: resolved.isHidden,
      }
    }
    return this.states[songIndex][sectionIndex]
  }

  defaultHideModeFor(
    sectionElement: SongSection | null,
    songIndex: number,
    sectionIndex: number
  ): HideMode {
    if (!sectionElement) {
      sectionElement = this.find(songIndex, sectionIndex)
    }
    return defaultHideMode(
      sectionLabel(sectionElement),
      sectionElement ? sectionElement.getRecommendedHideMode() : 'none',
      getSectionDefaults()
    )
  }

  async setHideMode(songIndex: number, sectionIndex: number, mode: string) {
    const component = this.find(songIndex, sectionIndex)
    const state = this.ensureOverride(songIndex, sectionIndex, component)

    if (mode === 'collapse') {
      const details = component?.getDetailsElement()
      if (details) {
        this.animateToggle(songIndex, sectionIndex, details)
      }
      return
    }

    const explicitShowMap: Record<string, HideMode> = {
      'show-all': 'none',
      'show-lyrics': 'chords',
      'show-chords': 'lyrics',
      'show-none': 'hide',
    }
    const mappedMode = (explicitShowMap[mode] || mode) as HideMode
    const isExplicit = Boolean(explicitShowMap[mode])

    if (mappedMode === 'hide') {
      if (isExplicit) {
        state.isHidden = true
        state.hideMode = 'hide'
        state.isCollapsed = false
      } else {
        state.isHidden = !state.isHidden
        if (state.isHidden) {
          state.hideMode = 'hide'
          state.isCollapsed = false
        } else {
          state.hideMode = 'none'
        }
      }
      this.host.saveState()
      this.updateDOM(songIndex, sectionIndex)
      return
    }

    if (state.isHidden) {
      state.isHidden = false
    }
    if (state.isCollapsed) {
      state.isCollapsed = false
    }

    if (isExplicit || mappedMode === 'none') {
      state.hideMode = mappedMode
    } else {
      state.hideMode = state.hideMode === mappedMode ? 'none' : mappedMode
    }
    this.host.saveState()
    this.updateDOM(songIndex, sectionIndex)
  }

  async animateToggle(songIndex: number, sectionIndex: number, details: HTMLDetailsElement) {
    const state = this.ensureOverride(songIndex, sectionIndex)
    const content = details.querySelector<HTMLElement>('.section-content')
    const wrapper = details.closest<HTMLElement>('.song-section-wrapper') || details
    if (!content) return

    const isEditMode = document.body.classList.contains('edit-mode')

    // Determine if we're opening or closing based on current state
    const isCurrentlyCollapsed = state.isCollapsed
    const isOpening = isCurrentlyCollapsed

    if (isOpening) {
      // Opening: update state first
      state.isCollapsed = false
      state.hideMode = 'none'
      this.host.saveState()

      // Update wrapper classes
      wrapper.classList.remove('section-collapsed')

      // In normal mode, open details; in edit mode it's always open
      if (!isEditMode) {
        details.open = true
      }

      // Get the natural height
      const startHeight = 0
      const endHeight = content.scrollHeight

      // Animate from 0 to full height
      content.style.height = `${startHeight}px`
      content.style.overflow = 'hidden'

      requestAnimationFrame(() => {
        content.style.transition = 'height 0.35s cubic-bezier(0.4, 0, 0.2, 1)'
        content.style.height = `${endHeight}px`

        // Clean up after animation
        setTimeout(() => {
          content.style.height = ''
          content.style.overflow = ''
          content.style.transition = ''
        }, 350)
      })
    } else {
      // Closing: animate first, then update state
      const startHeight = content.scrollHeight
      const endHeight = 0

      // Set explicit height
      content.style.height = `${startHeight}px`
      content.style.overflow = 'hidden'

      requestAnimationFrame(() => {
        content.style.transition = 'height 0.35s cubic-bezier(0.4, 0, 0.2, 1)'
        content.style.height = `${endHeight}px`

        // After animation completes, update state
        setTimeout(async () => {
          state.isCollapsed = true
          state.hideMode = 'collapse'
          this.host.saveState()

          // Update wrapper classes (adds section-collapsed)
          wrapper.classList.add('section-collapsed')

          // In normal mode, close details; in edit mode keep it open
          if (!isEditMode) {
            details.open = false
          }

          content.style.height = ''
          content.style.overflow = ''
          content.style.transition = ''
        }, 350)
      })
    }
  }

  updateDOM(songIndex: number, sectionIndex: number) {
    const component = this.find(songIndex, sectionIndex)
    if (!component) {
      return
    }
    const state = this.resolve(songIndex, sectionIndex, component)
    const isEditMode = document.body.classList.contains('edit-mode')
    // Apply state via reactive properties
    component.hideMode = state.hideMode
    component.isCollapsed = state.isCollapsed
    component.isHidden = state.isHidden
    component.editMode = isEditMode
  }

  listen() {
    const container = this.host.root.querySelector<HTMLElement>('.song-container')
    if (!container) return

    if (!this.#actionHandler) {
      this.#actionHandler = event => {
        const { songIndex, sectionIndex, action } = event
        if (typeof songIndex !== 'number' || typeof sectionIndex !== 'number' || !action) {
          return
        }
        this.setHideMode(songIndex, sectionIndex, action)
      }
      container.addEventListener(SectionActionEvent.type, this.#actionHandler)
    }

    if (!this.#toggleHandler) {
      this.#toggleHandler = event => {
        const { songIndex, sectionIndex } = event
        if (typeof songIndex !== 'number' || typeof sectionIndex !== 'number') {
          return
        }
        const component = this.find(songIndex, sectionIndex)
        const details = component?.getDetailsElement()
        if (details) {
          this.animateToggle(songIndex, sectionIndex, details)
        }
      }
      container.addEventListener(SectionToggleEvent.type, this.#toggleHandler)
    }
  }
}

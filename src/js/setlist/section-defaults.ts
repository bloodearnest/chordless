/**
 * What a part of a song (a verse, the chorus) shows when the user hasn't chosen otherwise: from
 * the defaults in their preferences (see getSectionDefaults), which are for every part ('all')
 * or for a part by its name, and from what the part has in it.
 */
import type { HideMode } from '../data-types.ts'
import type { SectionDefaults } from '../preferences.ts'

/** The hide mode a choice in the preferences stands for ('lyrics' hides the chords, and so on) */
export function hideModeForChoice(choice: unknown): HideMode {
  switch (String(choice || '').toLowerCase()) {
    case 'lyrics':
      return 'chords'
    case 'chords':
      return 'lyrics'
    case 'collapse':
      return 'collapse'
    case 'hide':
    case 'hidden':
      return 'hide'
    default:
      // 'all', 'show-all', 'default', 'none', and anything that isn't a choice
      return 'none'
  }
}

/** A part's name as the defaults name it: lower case, trimmed */
export function sectionLabel(section: { dataset?: DOMStringMap; label?: string } | null): string {
  const label = section?.dataset?.label || section?.label || ''
  return label.trim().toLowerCase()
}

/**
 * The hide mode for a part named `label`, which has `recommended` as its own (the one that
 * suits what is in it). A choice that would leave nothing to show collapses the part instead.
 */
export function defaultHideMode(
  label: string,
  recommended: HideMode,
  defaults: SectionDefaults
): HideMode {
  const choice = label && Object.hasOwn(defaults, label) ? defaults[label] : defaults.all
  const wanted = hideModeForChoice(choice)
  if (wanted === 'none') return recommended
  // Chords only, for a part with only words (or the other way round)
  if (wanted === 'chords' && recommended === 'lyrics') return 'collapse'
  if (wanted === 'lyrics' && recommended === 'chords') return 'collapse'
  return wanted
}

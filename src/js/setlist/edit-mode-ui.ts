/**
 * What entering and leaving edit mode does to a song's page: the classes on <body>, the header,
 * the key and capo selectors, and the fades of the edit controls in and the normal ones out.
 * (What the sections show, and saving, are the page's.)
 */
import type { AppHeader } from '../../components/app-header.ts'
import type { CapoSelector } from '../../components/capo-selector.ts'
import type { KeySelector } from '../../components/key-selector.ts'
import type { MusicalMetadataDisplay } from '../../components/musical-metadata-display.ts'

/** How long the controls take to fade, as the CSS has it */
const FADE_MS = 250

/** Whether edit mode is on: it is <body>'s, for the stylesheet and every page to see */
export function isEditMode(): boolean {
  return document.body.classList.contains('edit-mode')
}

/** Turn edit mode on or off on <body> (what a page shows for it is the page's) */
export function setBodyEditMode(on: boolean): void {
  document.body.classList.toggle('edit-mode', on)
  document.body.toggleAttribute('data-edit-mode', on)
}

const all = (root: ParentNode, selector: string) => root.querySelectorAll<HTMLElement>(selector)

/** Edit controls fade in, the normal ones out */
export function enterEditMode(
  root: ParentNode,
  appHeader: AppHeader,
  { capoEnabled }: { capoEnabled: boolean }
) {
  setBodyEditMode(true)
  appHeader.editMode = true

  const musicalMetadata = root.querySelector<MusicalMetadataDisplay>('#musical-metadata')
  if (musicalMetadata) musicalMetadata.editMode = true
  const keySelector = root.querySelector<KeySelector>('#key-selector')
  if (keySelector) keySelector.editMode = true
  const capoSelector = root.querySelector<CapoSelector>('#capo-selector')
  if (capoSelector && capoEnabled) capoSelector.editMode = true

  // Clear inline display:none if it was set during previous exit
  for (const control of all(root, '.edit-mode-control')) control.style.display = ''

  // Fade the edit controls in after a frame; once that is done, the normal ones are gone
  requestAnimationFrame(() => {
    for (const control of all(root, '.edit-mode-control')) control.classList.add('fade-in')
  })
  setTimeout(() => {
    for (const control of all(root, '.normal-mode-control')) control.classList.add('fade-complete')
  }, FADE_MS)
}

/** Everything fades at once; `whenFaded` is called once it has */
export function leaveEditMode(root: ParentNode, appHeader: AppHeader, whenFaded: () => void) {
  setBodyEditMode(false)
  appHeader.editMode = false

  const musicalMetadata = root.querySelector<MusicalMetadataDisplay>('#musical-metadata')
  if (musicalMetadata) musicalMetadata.editMode = false
  const keySelector = root.querySelector<KeySelector>('#key-selector')
  if (keySelector) keySelector.editMode = false
  const capoSelector = root.querySelector<CapoSelector>('#capo-selector')
  if (capoSelector) capoSelector.editMode = false

  for (const control of all(root, '.edit-mode-control')) control.classList.remove('fade-in')
  for (const control of all(root, '.normal-mode-control')) control.classList.remove('fade-complete')

  setTimeout(() => {
    // Hide the edit controls completely now that the fade is done
    for (const control of all(root, '.edit-mode-control')) control.style.display = 'none'
    whenFaded()
  }, FADE_MS)
}

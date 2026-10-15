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

const all = (root: ParentNode, selector: string) => root.querySelectorAll<HTMLElement>(selector)

/** Edit controls fade in, the normal ones out. `keyEditable` is false for a reader */
export function enterEditMode(
  root: ParentNode,
  appHeader: AppHeader,
  { keyEditable, capoEnabled }: { keyEditable: boolean; capoEnabled: boolean }
) {
  document.body.classList.add('edit-mode')
  document.body.setAttribute('data-edit-mode', '')
  appHeader.editMode = true

  const musicalMetadata = root.querySelector<MusicalMetadataDisplay>('#musical-metadata')
  if (musicalMetadata) musicalMetadata.editMode = true
  const keySelector = root.querySelector<KeySelector>('#key-selector')
  if (keySelector) keySelector.editMode = keyEditable
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
  document.body.classList.remove('edit-mode')
  document.body.removeAttribute('data-edit-mode')
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

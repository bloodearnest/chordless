/**
 * Icon library: the inner SVG of each icon, drawn by <app-icon> in a 24x24
 * viewBox as 2px outlines in the current colour.
 *
 * From Lucide 0.460.0 (https://lucide.dev), under its ISC licence:
 * Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as
 * part of Feather (MIT). All other copyright (c) for Lucide are held by
 * Lucide Contributors 2022.
 *
 * The keys are Chordless's names; the comment after each names its source icon.
 * The treble clef is Leipzig’s gClef (E050), extracted unchanged from Verovio 6.0.1
 * SVG output (SIL Open Font License 1.1; see src/licences.html).
 */

export const icons = {
  // Media controls
  play: '<polygon points="6 3 20 12 6 21 6 3" />', // play
  pause:
    '<rect x="14" y="4" width="4" height="16" rx="1" /><rect x="6" y="4" width="4" height="16" rx="1" />', // pause
  stop: '<rect width="18" height="18" x="3" y="3" rx="2" />', // square
  'skip-next': '<polygon points="5 4 15 12 5 20 5 4" /><line x1="19" x2="19" y1="5" y2="19" />', // skip-forward
  'skip-previous':
    '<polygon points="19 20 9 12 19 4 19 20" /><line x1="5" x2="5" y1="19" y2="5" />', // skip-back

  // UI controls
  settings:
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" />', // settings
  edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" />', // pencil
  info: '<circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />', // info
  // Just the i, for a button that has its own circle: as tall as the icons beside it in the header
  // (the pencil, share), since a thin i drawn smaller made its circle look smaller than theirs
  'info-mark': '<path d="M12 20.5v-10.5" /><path d="M12 4h.01" />',
  close: '<path d="M18 6 6 18" /><path d="m6 6 12 12" />', // x
  menu: '<line x1="4" x2="20" y1="12" y2="12" /><line x1="4" x2="20" y1="6" y2="6" /><line x1="4" x2="20" y1="18" y2="18" />', // menu

  // Navigation
  'chevron-left': '<path d="m15 18-6-6 6-6" />', // chevron-left
  'chevron-right': '<path d="m9 18 6-6-6-6" />', // chevron-right
  'chevron-up': '<path d="m18 15-6-6-6 6" />', // chevron-up
  'chevron-down': '<path d="m6 9 6 6 6-6" />', // chevron-down
  'arrow-left': '<path d="m12 19-7-7 7-7" /><path d="M19 12H5" />', // arrow-left

  // Actions
  add: '<path d="M5 12h14" /><path d="M12 5v14" />', // plus
  remove: '<path d="M5 12h14" />', // minus
  check: '<path d="M20 6 9 17l-5-5" />', // check
  delete:
    '<path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" />', // trash-2
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />', // copy
  search: '<circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />', // search
  share:
    '<circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" x2="15.42" y1="13.51" y2="17.49" /><line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />', // share-2
  radio:
    '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" /><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" /><circle cx="12" cy="12" r="2" /><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" /><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" />', // radio
  upload:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" x2="12" y1="3" y2="15" />', // upload

  // Places in the app
  grid: '<rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" />', // layout-grid
  calendar:
    '<path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" />', // calendar
  music:
    '<path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />', // music
  'treble-clef':
    '<path d="M4.5 8H19.5M4.5 12H19.5M4.5 16H19.5" stroke-width="0.8" /><path fill="currentColor" stroke="none" transform="translate(7.515 15.6) scale(.013 -.013)" d="M441 -245c-23 -4 -48 -6 -76 -6c-59 0 -102 7 -130 20c-88 42 -150 93 -187 154c-26 44 -43 103 -48 176c0 6 -1 13 -1 19c0 54 15 111 45 170c29 57 65 106 110 148s96 85 153 127c-3 16 -8 46 -13 92c-4 43 -5 73 -5 89c0 117 16 172 69 257c34 54 64 82 89 82 c21 0 43 -30 69 -92s39 -115 41 -159v-15c0 -109 -21 -162 -67 -241c-13 -20 -63 -90 -98 -118c-13 -9 -25 -19 -37 -29l31 -181c8 1 18 2 28 2c58 0 102 -12 133 -35c59 -43 92 -104 98 -184c1 -7 1 -15 1 -22c0 -123 -87 -209 -181 -248c8 -57 17 -110 25 -162 c5 -31 6 -58 6 -80c0 -30 -5 -53 -14 -70c-35 -64 -88 -99 -158 -103c-5 0 -11 -1 -16 -1c-37 0 -72 10 -108 27c-50 24 -77 59 -80 105v11c0 29 7 55 20 76c18 28 45 42 79 44h6c49 0 93 -42 97 -87v-9c0 -51 -34 -86 -105 -106c17 -24 51 -36 102 -36c62 0 116 43 140 85 c9 16 13 41 13 74c0 20 -1 42 -5 67c-8 53 -18 106 -26 159zM461 939c-95 0 -135 -175 -135 -286c0 -24 2 -48 5 -71c50 39 92 82 127 128c40 53 60 100 60 140v8c-4 53 -22 81 -55 81h-2zM406 119l54 -326c73 25 110 78 110 161c0 7 0 15 -1 23c-7 95 -57 142 -151 142h-12 zM382 117c-72 -2 -128 -47 -128 -120v-7c2 -46 43 -99 75 -115c-3 -2 -7 -5 -10 -10c-70 33 -116 88 -123 172v11c0 68 44 126 88 159c23 17 49 29 78 36l-29 170c-21 -13 -52 -37 -92 -73c-50 -44 -86 -84 -109 -119c-45 -69 -67 -130 -67 -182v-13c5 -68 35 -127 93 -176 s125 -73 203 -73c25 0 50 3 75 9c-19 111 -36 221 -54 331z" />', // Verovio 6.0.1 Leipzig gClef (E050), with three lighter staff lines
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />', // bookmark
  layers:
    '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" /><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" /><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />', // layers

  // Status
  sun: '<circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />', // sun
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />', // moon
  clock: '<circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />', // clock
  warning:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" />', // triangle-alert
  refresh:
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" />', // refresh-cw
  help: '<circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3" /><path d="M12 17h.01" />', // circle-help
  ban: '<circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" />', // ban
} satisfies Record<string, string>

/** The name of an icon in the library */
export type IconName = keyof typeof icons

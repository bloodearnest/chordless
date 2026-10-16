/**
 * Complete, valid records for tests to start from. Pass only what the test is about:
 * `makeSetlist({ date: '2026-01-04' })`. A test that needs a record the app would never
 * hold (a setlist with no songs list, a chart with no sections) says so with
 * `as unknown as T` where it uses it, so the lie is visible.
 */

import type {
  ChartSection,
  ParsedChart,
  Setlist,
  SetlistEntry,
  SetlistLocalState,
  SongInput,
} from '../src/js/data-types.ts'
import type { ImportedSong } from '../src/js/email-setlist.ts'
import type { PadSet } from '../src/js/pad-set-service.ts'

const NOW = '2026-10-11T10:00:00.000Z'

export const makeEntry = (overrides: Partial<SetlistEntry> = {}): SetlistEntry => ({
  order: 0,
  songId: 'title-song',
  songUuid: 'song-uuid',
  key: null,
  tempo: null,
  notes: '',
  ...overrides,
})

export const makeSetlist = (overrides: Partial<Setlist> = {}): Setlist => ({
  id: 'setlist-1',
  date: '2026-10-11',
  time: '10:30',
  type: 'Church Service',
  name: '',
  owner: 'Ann',
  songs: [],
  createdDate: NOW,
  modifiedDate: NOW,
  ...overrides,
})

export const makeLocalState = (setlistId: string): SetlistLocalState => ({
  setlistId,
  padsEnabled: true,
  padSound: null,
  clickEnabled: true,
  sectionVisibility: {},
  lastUsedDate: NOW,
})

export const makeSong = (overrides: Partial<SongInput> = {}): SongInput => ({
  uuid: 'song-uuid',
  id: 'title-song',
  variantOf: null,
  isDefault: true,
  variantLabel: '',
  chordproFileId: 'chordpro-song',
  ccliNumber: null,
  title: 'Song',
  titleNormalized: 'song',
  author: null,
  copyright: null,
  key: null,
  originalKey: null,
  tempo: null,
  originalTempo: null,
  time: null,
  importDate: NOW,
  importUser: null,
  importSource: 'test',
  sourceUrl: null,
  modifiedDate: NOW,
  driveFileId: null,
  driveModifiedTime: null,
  lastSyncedAt: null,
  contentHash: '',
  ...overrides,
})

export const makePadSet = (overrides: Partial<PadSet> = {}): PadSet => ({
  id: 'drive-pads',
  name: 'Pads',
  ...overrides,
})

/** A chart of one line per section; each section is the chords of that line's segments */
export const makeChart = (...sections: string[][]): ParsedChart => ({
  metadata: {},
  sections: sections.map(
    (chords): ChartSection => ({
      type: 'section',
      label: null,
      lines: [{ segments: chords.map(chord => ({ chord, lyrics: 'la ' })) }],
    })
  ),
})

/** A song read from an email, with nothing known but its title */
export const makeImportedSong = (
  title: string,
  over: Partial<ImportedSong> = {}
): ImportedSong => ({
  title,
  titles: [title],
  author: null,
  key: null,
  tempo: null,
  time: null,
  ccli: null,
  chartFilename: null,
  listed: null,
  notes: '',
  ...over,
})

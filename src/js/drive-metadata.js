/**
 * Drive file metadata for setlists and songs.
 *
 * The one place that decides a synced file's name, MIME type and appProperties.
 * Every upload and update goes through here, so files created or updated by any
 * path look the same. appProperties hold only what sync needs and can't get from
 * the file's content: identity, and for songs, variant relationships and import
 * provenance. Everything else (leader, date, title...) lives in the content, so
 * it can't go stale here.
 */

import { ChordProParser } from './parser.js'

export const APP_VERSION = '1.0.0'

/**
 * appProperties written by earlier versions that are no longer used. Updates set
 * them to null (which removes them) so old files converge on the current shape.
 */
const RETIRED_SETLIST_PROPERTIES = ['resourceType', 'date', 'type', 'leader', 'name']
const RETIRED_SONG_PROPERTIES = [
  'ccliNumber',
  'title',
  'titleNormalized',
  'contentHash',
  'modifiedDate',
  'versionId',
  'versionLabel',
  'createdAt',
  'updatedAt',
  'sourceUrl',
]

const parser = new ChordProParser()

/**
 * Lowercase, keep word characters, spaces to dashes: "John Smith!" -> "john-smith".
 * Song filenames collapse repeated dashes and setlist filenames don't
 * ("Leaders - Tue" -> "leaders---tue"), as they always have, so existing files
 * keep their names.
 */
function slug(text, { collapseDashes }) {
  const s = String(text)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
  return (collapseDashes ? s.replace(/--+/g, '-') : s).trim()
}

/**
 * Setlist filename: date-leader-type[-name].json
 * e.g. "2025-11-10-john-smith-church-service.json"
 */
export function setlistFilename(setlist) {
  const parts = [setlist.date || setlist.id]
  for (const part of [setlist.owner, setlist.type, setlist.name]) {
    const s = part ? slug(part, { collapseDashes: false }) : ''
    if (s) parts.push(s)
  }
  return `${parts.join('-')}.json`
}

/** Chord chart filename: title[-ccli].txt, e.g. "amazing-grace-4779.txt" */
export function chordproFilename(title, ccliNumber) {
  const base = slug(title, { collapseDashes: true })
  return `${ccliNumber ? `${base}-${ccliNumber}` : base}.txt`
}

/**
 * Metadata for a setlist's Drive file.
 * @returns {{name: string, mimeType: string, appProperties: object}}
 */
export function setlistFileMetadata(setlist, { organisationId }) {
  return {
    name: setlistFilename(setlist),
    mimeType: 'application/json',
    appProperties: {
      organisationId: organisationId || '',
      setlistId: setlist.id,
      appVersion: APP_VERSION,
    },
  }
}

/** The title, CCLI number and variant label a song's file is named and labelled by */
export function songFileDetails(song, chordproFile) {
  const parsed = chordproFile ? parser.parse(chordproFile.content) : { metadata: {} }
  return {
    title: song.title || parsed.metadata?.title || 'Untitled',
    ccliNumber: song.ccliNumber || '',
    variantLabel:
      song.variantLabel || (song.isDefault ? 'Original' : song.variantOf ? 'Variant' : 'Original'),
  }
}

/**
 * Metadata for a song variant's chord chart file.
 * @returns {{name: string, mimeType: string, appProperties: object}}
 */
export function songFileMetadata(song, chordproFile, { organisationId }) {
  const { title, ccliNumber, variantLabel } = songFileDetails(song, chordproFile)
  return {
    name: chordproFilename(title, ccliNumber),
    mimeType: 'text/plain',
    appProperties: {
      type: 'chordpro',
      organisationId: organisationId || '',
      songId: song.id,
      songUuid: song.uuid || song.id,
      variantOf: song.variantOf || '',
      isDefault: song.isDefault ? 'true' : 'false',
      variantLabel,
      importDate: song.importDate || '',
      importUser: song.importUser || '',
      importSource: song.importSource || '',
      appVersion: APP_VERSION,
    },
  }
}

/**
 * Metadata for updating an existing file: name and appProperties (not mimeType,
 * which doesn't change), with retired appProperties removed.
 */
export function forUpdate({ name, appProperties }, kind) {
  const retired = kind === 'setlist' ? RETIRED_SETLIST_PROPERTIES : RETIRED_SONG_PROPERTIES
  return {
    name,
    appProperties: {
      ...Object.fromEntries(retired.map(key => [key, null])),
      ...appProperties,
    },
  }
}

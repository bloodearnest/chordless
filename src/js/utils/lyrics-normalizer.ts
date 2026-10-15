/** A piece of a lyric line: the lyrics under (or after) one chord */
interface LyricSegment {
  lyrics?: string | null
}

/** A segment as normalizeSegmentsForHiddenChords gives it back */
export type NormalizedSegment<T extends LyricSegment> = Omit<T, 'lyrics'> & {
  lyrics: string
  /** Whether it continues the previous segment's word, with no space between */
  __joinWithPrev: boolean
}

/** One part of a chord as displayed: the root and plain text, or an extension (7, sus4, ...) */
export interface ChordDisplaySegment {
  type: 'base' | 'extension'
  value: string
}

export function segmentHasVisibleLyrics(segment: LyricSegment | null | undefined): boolean {
  const value = segment?.lyrics
  if (typeof value !== 'string') {
    return false
  }
  const normalized = value.replace(/\s*-\s*/g, '').trim()
  return normalized.length > 0
}

export function normalizeSegmentsForHiddenChords<T extends LyricSegment>(
  segments: T[]
): NormalizedSegment<T>[] {
  const normalized: NormalizedSegment<T>[] = []
  let carryJoin = false

  for (const segment of segments) {
    const original = segment.lyrics || ''
    const hasLeadingGlue = /^\s*-\s*/.test(original)
    const hasTrailingGlue = /\s*-\s*$/.test(original)
    const isGlueOnly = /-/.test(original) && original.replace(/[\s-]/g, '') === ''

    const joinWithPrev = carryJoin || hasLeadingGlue

    const text = original
      .replace(/\s*-\s*/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    normalized.push({ ...segment, lyrics: text, __joinWithPrev: joinWithPrev })

    const producesLyrics = text.length > 0
    if (producesLyrics) {
      carryJoin = hasTrailingGlue || isGlueOnly
    } else {
      carryJoin = carryJoin || hasTrailingGlue || isGlueOnly
    }
  }

  return normalized
}

export function formatHiddenLyricsText(
  text: string,
  previousHadLyrics = false,
  joinWithPrev = false
): string {
  if (!text) {
    return ''
  }
  let normalized = text
  if (previousHadLyrics && !joinWithPrev) {
    normalized = ` ${normalized}`
  }
  return normalized
}

const CHORD_EXTENSION_PATTERN =
  /(maj7|maj9|maj11|maj13|add(?:9|11|13)?|sus(?:2|4)?|sus|dim7|dim|aug(?:\d+)?|\+(?:\d+)?|mMaj7|°7|°|ø7|\d+\([^)]+\)|\(\d+\)|[#b♯♭]?\d+(?:[#b♯♭]\d+)?)/gi

export function splitChordDisplaySegments(chordText: string): ChordDisplaySegment[] {
  if (!chordText) {
    return []
  }
  let text = chordText
  const segments: ChordDisplaySegment[] = []

  let hasWrapper = false
  if (text.startsWith('(') && text.endsWith(')') && text.length > 2) {
    hasWrapper = true
    text = text.slice(1, -1)
  }

  const match = text.match(/^([A-G][#b♯♭]?)(.*)$/)
  if (!match) {
    if (hasWrapper) {
      return [
        { type: 'base', value: '(' },
        { type: 'base', value: text },
        { type: 'base', value: ')' },
      ]
    }
    return [{ type: 'base', value: text }]
  }
  const [, root, rest] = match
  if (hasWrapper) {
    segments.push({ type: 'base', value: '(' })
  }
  segments.push({ type: 'base', value: root })
  if (!rest) {
    if (hasWrapper) {
      segments.push({ type: 'base', value: ')' })
    }
    return segments
  }

  let lastIndex = 0
  CHORD_EXTENSION_PATTERN.lastIndex = 0

  for (const extMatch of rest.matchAll(CHORD_EXTENSION_PATTERN)) {
    const index = extMatch.index
    if (index > lastIndex) {
      segments.push({ type: 'base', value: rest.slice(lastIndex, index) })
    }
    segments.push({ type: 'extension', value: extMatch[0] })
    lastIndex = index + extMatch[0].length
  }

  if (lastIndex < rest.length) {
    segments.push({ type: 'base', value: rest.slice(lastIndex) })
  }

  if (hasWrapper) {
    segments.push({ type: 'base', value: ')' })
  }

  return segments
}

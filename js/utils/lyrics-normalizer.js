export function segmentHasVisibleLyrics(segment) {
  const value = segment?.lyrics
  if (typeof value !== 'string') {
    return false
  }
  const normalized = value.replace(/\s*-\s*/g, '').trim()
  return normalized.length > 0
}

export function normalizeSegmentsForHiddenChords(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return []
  }

  const normalized = []
  let carryJoin = false

  for (const segment of segments) {
    const clone = { ...segment }
    const original = clone.lyrics || ''
    const hasLeadingGlue = /^\s*-\s*/.test(original)
    const hasTrailingGlue = /\s*-\s*$/.test(original)
    const isGlueOnly = /-/.test(original) && original.replace(/[\s-]/g, '') === ''

    clone.__joinWithPrev = carryJoin || hasLeadingGlue

    let text = original
    if (text) {
      text = text.replace(/\s*-\s*/g, '')
      text = text.replace(/\s+/g, ' ').trim()
    } else {
      text = ''
    }

    clone.lyrics = text
    normalized.push(clone)

    const producesLyrics = text.length > 0
    if (producesLyrics) {
      carryJoin = hasTrailingGlue || isGlueOnly
    } else {
      carryJoin = carryJoin || hasTrailingGlue || isGlueOnly
    }
  }

  return normalized
}

export function formatHiddenLyricsText(text, previousHadLyrics = false, joinWithPrev = false) {
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
  /(maj7|maj9|maj11|maj13|add(?:9|11|13)?|sus(?:2|4)?|sus|dim7|dim|aug(?:\d+)?|\+(?:\d+)?|mMaj7|°7|°|ø7|\(\d+\)|[#b♯♭]?\d+(?:[#b♯♭]\d+)?)/gi

export function splitChordDisplaySegments(chordText) {
  if (!chordText) {
    return []
  }
  let text = chordText
  const segments = []

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
    const index = extMatch.index ?? 0
    if (index > lastIndex) {
      const between = rest.slice(lastIndex, index)
      if (between) {
        segments.push({ type: 'base', value: between })
      }
    }
    segments.push({ type: 'extension', value: extMatch[0] })
    lastIndex = index + extMatch[0].length
  }

  if (lastIndex < rest.length) {
    const tail = rest.slice(lastIndex)
    if (tail) {
      segments.push({ type: 'base', value: tail })
    }
  }

  if (hasWrapper) {
    segments.push({ type: 'base', value: ')' })
  }

  return segments
}

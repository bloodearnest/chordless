export function segmentHasVisibleLyrics(segment) {
  const value = segment?.lyrics;
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.replace(/\s*-\s*/g, '').trim();
  return normalized.length > 0;
}

export function normalizeSegmentsForHiddenChords(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return [];
  }

  const normalized = [];
  let carryJoin = false;

  for (const segment of segments) {
    const clone = { ...segment };
    const original = clone.lyrics || '';
    const hasLeadingGlue = /^\s*-\s*/.test(original);
    const hasTrailingGlue = /\s*-\s*$/.test(original);
    const isGlueOnly = /-/.test(original) && original.replace(/[\s-]/g, '') === '';

    clone.__joinWithPrev = carryJoin || hasLeadingGlue;

    let text = original;
    if (text) {
      text = text.replace(/\s*-\s*/g, '');
      text = text.replace(/\s+/g, ' ').trim();
    } else {
      text = '';
    }

    clone.lyrics = text;
    normalized.push(clone);

    const producesLyrics = text.length > 0;
    if (producesLyrics) {
      carryJoin = hasTrailingGlue || isGlueOnly;
    } else {
      carryJoin = carryJoin || hasTrailingGlue || isGlueOnly;
    }
  }

  return normalized;
}

export function formatHiddenLyricsText(text, previousHadLyrics = false, joinWithPrev = false) {
  if (!text) {
    return '';
  }
  let normalized = text;
  if (previousHadLyrics && !joinWithPrev) {
    normalized = ` ${normalized}`;
  }
  return normalized;
}

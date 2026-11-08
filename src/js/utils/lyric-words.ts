/**
 * Lyrics as they are compared, by the annotations finding their line again and the melody
 * finding its chart section: the words, whatever the case, the spaces, and the marks between them
 * (an apostrophe, straight or curly, a comma, a dash).
 */

/** The text in lower case, its marks made spaces and its spaces single: "Don’t, stop!" is "don t stop" */
export function normalLyrics(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The words of a text, as `normalLyrics` makes them */
export function lyricWords(text: string): string[] {
  const normal = normalLyrics(text)
  return normal ? normal.split(' ') : []
}

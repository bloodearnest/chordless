// @ts-nocheck: not typed yet (remove this line when converting)
/**
 * The songs whose title, artist or lyrics contain the search term, ignoring case.
 * An empty search matches every song (and gives back the same array).
 *
 * (Lyrics are only searched for songs that have a lyricsText; nothing sets one yet:
 * see the TODO.)
 */
export function filterSongs(songs, searchTerm) {
  const term = searchTerm.toLowerCase().trim()
  if (!term) return songs
  return songs.filter(song =>
    [song.title, song.artist, song.lyricsText].some(text =>
      (text || '').toLowerCase().includes(term)
    )
  )
}

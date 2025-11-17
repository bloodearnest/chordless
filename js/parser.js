import { normalizeSongChordsToStandard } from './transpose.js';

// Custom ChordPro parser for SongSelect format files

export class ChordProParser {
  parse(content) {
    const lines = content.split('\n');
    const metadata = {};
    const sections = [];
    let currentSection = null;
    let inTrailer = false;
    let trailerLines = [];

    for (let line of lines) {
      line = line.trim();

      // Check if we've hit the CCLI trailer
      if (line.startsWith('CCLI Song #')) {
        inTrailer = true;
        const match = line.match(/CCLI Song # (\d+)/);
        if (match) {
          metadata.ccliSongNumber = match[1];
        }
        trailerLines.push(line);
        continue;
      }

      // Collect trailer lines
      if (inTrailer) {
        if (line) {
          trailerLines.push(line);
        }
        continue;
      }

      // Parse metadata directives
      if (line.startsWith('{') && line.endsWith('}')) {
        const directive = line.slice(1, -1);
        const colonIndex = directive.indexOf(':');

        if (colonIndex > 0) {
          const key = directive.slice(0, colonIndex).trim();
          const value = directive.slice(colonIndex + 1).trim();

          if (key === 'comment') {
            // Start a new section
            if (currentSection) {
              sections.push(currentSection);
            }
            currentSection = {
              type: 'section',
              label: value,
              lines: [],
            };
          } else {
            metadata[key] = value;
          }
        }
        continue;
      }

      // Skip empty lines
      if (!line) {
        continue;
      }

      // Parse chord/lyric lines
      if (!currentSection) {
        currentSection = {
          type: 'section',
          label: null,
          lines: [],
        };
      }

      currentSection.lines.push(this.parseLine(line));
    }

    // Add final section
    if (currentSection && currentSection.lines.length > 0) {
      sections.push(currentSection);
    }

    // Add trailer to metadata
    if (trailerLines.length > 0) {
      metadata.ccliTrailer = trailerLines.join('\n');
    }

    const parsed = { metadata, sections };
    if (parsed.metadata.key) {
      normalizeSongChordsToStandard(parsed, parsed.metadata.key);
    }
    return parsed;
  }

  parseLine(line) {
    const segments = [];
    let currentChord = '';
    let currentLyrics = '';
    let inChord = false;
    let i = 0;

    while (i < line.length) {
      if (line[i] === '[') {
        // Save any accumulated lyrics with the previous chord
        if (currentChord || currentLyrics) {
          // Collapse multiple spaces in lyrics to single space
          const collapsedLyrics = currentLyrics.replace(/ {2,}/g, ' ');
          segments.push({ chord: currentChord, lyrics: collapsedLyrics });
          currentChord = '';
          currentLyrics = '';
        }
        inChord = true;
        i++;
      } else if (line[i] === ']' && inChord) {
        inChord = false;
        i++;
      } else if (inChord) {
        currentChord += line[i];
        i++;
      } else {
        currentLyrics += line[i];
        i++;
      }
    }

    // Add final segment
    if (currentChord || currentLyrics) {
      // Collapse multiple spaces in lyrics to single space
      const collapsedLyrics = currentLyrics.replace(/ {2,}/g, ' ');
      segments.push({ chord: currentChord, lyrics: collapsedLyrics });
    }

    return { segments };
  }
}

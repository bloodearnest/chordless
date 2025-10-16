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
                            lines: []
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
                    lines: []
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

        return { metadata, sections };
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

    toHTML(parsed, songIndex = 0) {
        let html = '';

        // Add title
        if (parsed.metadata.title) {
            html += `<div class="song-header">`;
            html += `<h2 class="song-title">${this.escapeHtml(parsed.metadata.title)}</h2>`;

            if (parsed.metadata.artist) {
                html += `<div class="song-artist">${this.escapeHtml(parsed.metadata.artist)}</div>`;
            }

            if (parsed.metadata.key) {
                html += `<div class="song-meta">`;
                html += `<span class="song-key">Key: ${this.escapeHtml(parsed.metadata.key)}</span>`;
                if (parsed.metadata.tempo) {
                    html += `<span class="song-tempo">Tempo: ${this.escapeHtml(parsed.metadata.tempo)}</span>`;
                }
                if (parsed.metadata.time) {
                    html += `<span class="song-time">Time: ${this.escapeHtml(parsed.metadata.time)}</span>`;
                }
                html += `</div>`;
            }

            // Add CCLI info if present
            if (parsed.metadata.ccliSongNumber) {
                html += `<div class="song-ccli">CCLI Song # ${this.escapeHtml(parsed.metadata.ccliSongNumber)}</div>`;
            }

            html += `</div>`;
        }

        // Add sections
        for (let i = 0; i < parsed.sections.length; i++) {
            const section = parsed.sections[i];

            if (section.label) {
                html += `<div class="song-section-wrapper" data-song-index="${songIndex}" data-section-index="${i}">`;
                html += `<details class="song-section" open>`;
                html += `<summary class="section-label">`;
                html += `<div class="section-header">`;
                html += `<span class="section-title">${this.escapeHtml(section.label)}</span>`;
                html += `<div class="section-controls">`;
                html += `<button class="section-control-btn section-collapse-btn" data-action="collapse">`;
                html += `<span class="control-icon">▼</span><span class="control-label">Collapse Section</span>`;
                html += `</button>`;
                html += `<button class="section-control-btn chords-toggle-btn" data-action="chords">`;
                html += `<span class="control-icon">♯</span><span class="control-label">Hide Chords</span>`;
                html += `</button>`;
                html += `<button class="section-control-btn lyrics-toggle-btn" data-action="lyrics">`;
                html += `<span class="control-icon">A</span><span class="control-label">Hide Lyrics</span>`;
                html += `</button>`;
                html += `<button class="section-control-btn section-hide-btn" data-action="hide">`;
                html += `<span class="control-icon">✕</span><span class="control-label">Hide Entire Section</span>`;
                html += `</button>`;
                html += `</div>`;
                html += `</div>`;
                html += `</summary>`;
                html += `<div class="section-content">`;
                html += this.renderLines(section.lines);
                html += `</div>`;
                html += `</details>`;
                html += `</div>`;
            } else {
                html += `<div class="song-section" data-song-index="${songIndex}" data-section-index="${i}">`;
                html += `<div class="section-content">`;
                html += this.renderLines(section.lines);
                html += `</div>`;
                html += `</div>`;
            }
        }

        return html;
    }

    renderLines(lines) {
        let html = '';
        let i = 0;

        while (i < lines.length) {
            // Check if this starts a group of bar-aligned lines
            const barGroup = this.findBarGroup(lines, i);

            if (barGroup.length > 1) {
                // Render bar-aligned group
                html += this.renderBarAlignedGroup(barGroup);
                i += barGroup.length;
            } else {
                // Render single line normally
                html += this.renderLine(lines[i]);
                i++;
            }
        }

        return html;
    }

    findBarGroup(lines, startIndex) {
        const group = [];

        for (let i = startIndex; i < lines.length; i++) {
            const line = lines[i];
            if (this.isBarLine_Line(line)) {
                group.push(line);
            } else {
                break;
            }
        }

        return group;
    }

    isBarLine_Line(line) {
        if (line.segments.length === 0) return false;

        // Check if all segments have no lyrics (chord-only) and at least one has a bar
        let hasBar = false;
        for (const segment of line.segments) {
            const hasLyrics = segment.lyrics && segment.lyrics.trim().length > 0;
            if (hasLyrics) return false;

            if (segment.chord && this.isBarLine(segment.chord)) {
                hasBar = true;
            }
        }

        return hasBar;
    }

    renderBarAlignedGroup(lines) {
        // Extract all bars and chords in order for each line, tracking their positions
        const lineData = lines.map(line => {
            const items = [];
            line.segments.forEach(segment => {
                if (segment.chord) {
                    items.push({
                        chord: segment.chord,
                        isBar: this.isBarLine(segment.chord)
                    });
                }
            });
            return items;
        });

        // Convert each line to measures
        const allMeasures = lineData.map(items => {
            const measures = [];
            let currentMeasure = [];

            for (const item of items) {
                if (item.isBar) {
                    measures.push({
                        chords: currentMeasure,
                        bar: item.chord
                    });
                    currentMeasure = [];
                } else {
                    currentMeasure.push(item.chord);
                }
            }

            // Add any remaining chords after the last bar
            if (currentMeasure.length > 0) {
                measures.push({
                    chords: currentMeasure,
                    bar: null
                });
            }

            return measures;
        });

        // Find the maximum number of measures
        const maxMeasures = Math.max(...allMeasures.map(m => m.length));

        // Create grid template with auto-sized columns
        const gridTemplate = 'repeat(' + maxMeasures + ', auto)';

        let html = `<div class="bar-group" style="grid-template-columns: ${gridTemplate}">`;

        for (const measures of allMeasures) {
            html += '<div class="chord-line bar-aligned">';

            // Render each measure
            for (let i = 0; i < maxMeasures; i++) {
                const measure = measures[i];
                const isFirstMeasure = i === 0;
                const isLastMeasure = i === maxMeasures - 1;

                if (measure) {
                    let measureClass = 'measure';
                    if (isFirstMeasure) measureClass += ' first-measure';
                    if (isLastMeasure) measureClass += ' last-measure';

                    html += `<span class="${measureClass}">`;

                    // Render chords in this measure
                    for (const chord of measure.chords) {
                        html += `<span class="chord-segment chord-only">`;
                        html += `<span class="chord">${this.escapeHtml(chord)}</span>`;
                        html += `</span>`;
                    }

                    // Render the bar if present
                    if (measure.bar) {
                        html += `<span class="chord-segment chord-only bar-marker">`;
                        html += `<span class="chord bar">${this.escapeHtml(measure.bar)}</span>`;
                        html += `</span>`;
                    }

                    html += '</span>';
                } else {
                    // Empty measure to maintain grid alignment
                    html += '<span class="measure"></span>';
                }
            }

            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    renderLine(line) {
        if (line.segments.length === 0) return '';

        let html = '<div class="chord-line">';

        for (const segment of line.segments) {
            const hasLyrics = segment.lyrics && segment.lyrics.trim().length > 0;
            const segmentClass = hasLyrics ? 'chord-segment' : 'chord-segment chord-only';

            html += `<span class="${segmentClass}">`;

            if (segment.chord) {
                const isBar = this.isBarLine(segment.chord);
                const chordClass = isBar ? 'chord bar' : 'chord';
                html += `<span class="${chordClass}">${this.escapeHtml(segment.chord)}</span>`;
            } else {
                html += `<span class="chord"></span>`;
            }

            if (hasLyrics) {
                html += `<span class="lyrics">${this.escapeHtml(segment.lyrics)}</span>`;
            }

            html += `</span>`;
        }

        html += '</div>';
        return html;
    }

    isBarLine(chord) {
        return chord === '|' || chord === '||' || chord === '||:' || chord === ':||';
    }

    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }
}

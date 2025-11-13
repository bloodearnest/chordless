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
        const fragment = document.createDocumentFragment();

        // Add title
        if (parsed.metadata.title) {
            const headerTemplate = document.getElementById('song-header-template');
            const headerClone = headerTemplate.content.cloneNode(true);

            const title = headerClone.querySelector('.song-title');
            title.textContent = parsed.metadata.title;

            const artist = headerClone.querySelector('.song-artist');
            if (parsed.metadata.artist) {
                artist.textContent = parsed.metadata.artist;
            } else {
                artist.remove();
            }

            const metaDiv = headerClone.querySelector('.song-meta');
            if (parsed.metadata.key || parsed.metadata.tempo || parsed.metadata.time) {
                const keySpan = headerClone.querySelector('.song-key');
                if (parsed.metadata.key) {
                    keySpan.textContent = `Key: ${parsed.metadata.key}`;
                } else {
                    keySpan.remove();
                }

                const tempoSpan = headerClone.querySelector('.song-tempo');
                if (parsed.metadata.tempo) {
                    tempoSpan.textContent = `Tempo: ${parsed.metadata.tempo}`;
                } else {
                    tempoSpan.remove();
                }

                const timeSpan = headerClone.querySelector('.song-time');
                if (parsed.metadata.time) {
                    timeSpan.textContent = `Time: ${parsed.metadata.time}`;
                } else {
                    timeSpan.remove();
                }
            } else {
                metaDiv.remove();
            }

            const ccliDiv = headerClone.querySelector('.song-ccli');
            if (parsed.metadata.ccliSongNumber) {
                ccliDiv.textContent = `CCLI Song # ${parsed.metadata.ccliSongNumber}`;
            } else {
                ccliDiv.remove();
            }

            fragment.appendChild(headerClone);
        }

        // Add sections
        for (let i = 0; i < parsed.sections.length; i++) {
            const section = parsed.sections[i];
            const sectionElement = document.createElement('song-section');
            sectionElement.setAttribute('song-index', songIndex);
            sectionElement.setAttribute('section-index', i);
            sectionElement.setAttribute('has-label', section.label ? 'true' : 'false');

            if (section.label) {
                const sectionTemplate = document.getElementById('section-with-label-template');
                const sectionClone = sectionTemplate.content.cloneNode(true);

                const wrapper = sectionClone.querySelector('.song-section-wrapper');
                wrapper.dataset.songIndex = songIndex;
                wrapper.dataset.sectionIndex = i;

                const sectionTitle = sectionClone.querySelector('.section-title');
                sectionTitle.textContent = section.label;

                const sectionContent = sectionClone.querySelector('.section-content');
                sectionContent.appendChild(this.renderLines(section.lines));

                sectionElement.appendChild(sectionClone);
            } else {
                const sectionTemplate = document.getElementById('section-without-label-template');
                const sectionClone = sectionTemplate.content.cloneNode(true);

                const sectionDiv = sectionClone.querySelector('.song-section');
                sectionDiv.dataset.songIndex = songIndex;
                sectionDiv.dataset.sectionIndex = i;

                const sectionContent = sectionClone.querySelector('.section-content');
                sectionContent.appendChild(this.renderLines(section.lines));

                sectionElement.appendChild(sectionClone);
            }

            fragment.appendChild(sectionElement);
        }

        return fragment;
    }

    renderLines(lines) {
        const fragment = document.createDocumentFragment();
        let i = 0;

        while (i < lines.length) {
            // Check if this starts a group of bar-aligned lines
            const barGroup = this.findBarGroup(lines, i);

            if (barGroup.length > 1) {
                // Render bar-aligned group
                fragment.appendChild(this.renderBarAlignedGroup(barGroup));
                i += barGroup.length;
            } else {
                // Render single line normally
                const lineElement = this.renderLine(lines[i]);
                if (lineElement) {
                    fragment.appendChild(lineElement);
                }
                i++;
            }
        }

        return fragment;
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
        const gridTemplate = `repeat(${maxMeasures}, auto)`;

        const barGroupTemplate = document.getElementById('bar-group-template');
        const barGroupClone = barGroupTemplate.content.cloneNode(true);
        const barGroup = barGroupClone.querySelector('.bar-group');
        barGroup.style.gridTemplateColumns = gridTemplate;

        for (const measures of allMeasures) {
            const chordLineDiv = document.createElement('div');
            chordLineDiv.className = 'chord-line bar-aligned';

            // Render each measure
            for (let i = 0; i < maxMeasures; i++) {
                const measure = measures[i];
                const isFirstMeasure = i === 0;
                const isLastMeasure = i === maxMeasures - 1;

                const measureTemplate = document.getElementById('measure-template');
                const measureClone = measureTemplate.content.cloneNode(true);
                const measureSpan = measureClone.querySelector('.measure');

                if (measure) {
                    if (isFirstMeasure) measureSpan.classList.add('first-measure');
                    if (isLastMeasure) measureSpan.classList.add('last-measure');

                    // Render chords in this measure
                    for (const chord of measure.chords) {
                        const segmentSpan = document.createElement('span');
                        segmentSpan.className = 'chord-segment chord-only';

                        const chordSpan = document.createElement('span');
                        chordSpan.className = 'chord';
                        chordSpan.textContent = chord;

                        segmentSpan.appendChild(chordSpan);
                        measureSpan.appendChild(segmentSpan);
                    }

                    // Render the bar if present
                    if (measure.bar) {
                        const segmentSpan = document.createElement('span');
                        segmentSpan.className = 'chord-segment chord-only bar-marker';

                        const chordSpan = document.createElement('span');
                        chordSpan.className = 'chord bar';
                        chordSpan.textContent = measure.bar;

                        segmentSpan.appendChild(chordSpan);
                        measureSpan.appendChild(segmentSpan);
                    }
                }

                chordLineDiv.appendChild(measureClone);
            }

            barGroup.appendChild(chordLineDiv);
        }

        return barGroupClone;
    }

    renderLine(line) {
        if (line.segments.length === 0) return null;

        const chordLineTemplate = document.getElementById('chord-line-template');
        const chordLineClone = chordLineTemplate.content.cloneNode(true);
        const chordLineDiv = chordLineClone.querySelector('.chord-line');

        for (const segment of line.segments) {
            const hasLyrics = segment.lyrics && segment.lyrics.trim().length > 0;

            const segmentTemplate = document.getElementById('chord-segment-template');
            const segmentClone = segmentTemplate.content.cloneNode(true);
            const segmentSpan = segmentClone.querySelector('.chord-segment');

            if (!hasLyrics) {
                segmentSpan.classList.add('chord-only');
            }

            const chordSpan = segmentClone.querySelector('.chord');
            if (segment.chord) {
                const isBar = this.isBarLine(segment.chord);
                const isInvalid = segment.valid === false;
                if (isBar) chordSpan.classList.add('bar');
                if (isInvalid) chordSpan.classList.add('invalid');
                chordSpan.textContent = segment.chord;
            }

            const lyricsSpan = segmentClone.querySelector('.lyrics');
            if (hasLyrics) {
                lyricsSpan.textContent = segment.lyrics;
            } else {
                lyricsSpan.remove();
            }

            chordLineDiv.appendChild(segmentClone);
        }

        return chordLineClone;
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

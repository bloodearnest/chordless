# Pad Looping Plan

## Goal

Reduce pad set storage footprint and support robust offline playback by trimming each pad file down to a short, seamless loop (e.g., 60 seconds) that can be repeated with crossfades.

## Proposed Approach

1. **Client-Side Trimming Pipeline**
   - When a pad set ZIP is uploaded, decode each MP3 in the browser using Web Audio (or a WASM decoder).
   - Extract the first minute (or user-selected segment) of audio and normalize levels.
   - Re-encode the trimmed segment (AAC/Opus via WASM) to produce a smaller file (~4 MB instead of 30–40 MB).
   - Store the trimmed file locally (IndexedDB/Cache) and upload that version to Drive.

2. **Loop Playback**
   - Update the media player to play pad audio in a seamless loop by overlapping two audio elements or Web Audio buffers with a short crossfade.
   - Define loop points (start/end) and fade durations so transitions remain smooth. Optionally allow per-pad-set loop settings if certain pads need longer segments.

3. **Offline Strategy**
   - Keep trimmed pads in IndexedDB for persistence; populate Cache Storage on demand for fast streaming.
   - If the cache entry is evicted, regenerate it from IndexedDB. Drive sync remains the source of truth for cross-device availability.

4. **Background Sync**
   - Stage trimmed files offline first. When connectivity is available, upload them to Drive and update metadata (file IDs, key mappings).
   - Handle conflicts if the same pad set already exists remotely by versioning or prompting the user.

5. **Considerations / Risks**
   - Some pads evolve over several minutes; looping a short segment might reduce tonal variety. We may need a way to pick loop-friendly regions.
   - Decoding/encoding large MP3s in the browser is CPU-intensive, especially on low-power devices. We might need to offload work to a worker or provide a fallback path (e.g., keep originals when processing fails).
   - Re-encoding introduces generation loss; evaluate whether the trimmed format should be lossless (larger) or high-quality AAC/Opus.

## Next Steps (when we tackle this)

1. Prototype client-side trim + re-encode for a single pad file.
2. Add loop scheduling support to the media player (overlap/crossfade).
3. Integrate trimming into the pad-set upload manager, including progress UI.
4. Update Drive sync and offline storage logic to handle staged, trimmed files.
5. QA loop quality across multiple pad libraries.

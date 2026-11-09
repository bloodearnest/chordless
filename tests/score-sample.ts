/** A one-measure melody for tests (C4, then G4 held three beats): the MusicXML score, and a record of it */

import { melodyRecord } from '../src/js/melody-record.ts'
import type { Score } from '../src/js/score.ts'
import { writeMusicXml } from '../src/js/score-musicxml.ts'
import { measure, melodyOf } from './score-build.ts'

export const sampleScore: Score = melodyOf('Test', [
  measure(1, ['C4:1:la', 'G4:2.5:la', 'G4:0.5:la']),
])

/** C4 to G4: low C for 1 beat, high G for 3 */
export const sampleRecord = (uuid: string, key: string | null = 'C') =>
  melodyRecord(uuid, writeMusicXml(sampleScore), key)

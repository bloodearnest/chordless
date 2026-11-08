/** `.mxl` (src/js/mxl.ts): the zip a notation program writes, and the one Chordless writes */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isZip, readMelodyFile, readMxl, writeMxl } from '../src/js/mxl.ts'

/** Zips made by Python's zipfile, with the score at a path container.xml names (and another XML file that is not it) */
const DEFLATED =
  'UEsDBBQAAAAIAEhSaF2fEQeaUQAAAGoAAAAWAAAATUVUQS1JTkYvY29udGFpbmVyLnhtbE3MMQ6AIAxA0auQ7oLuBc5CSA0k0BpAo7fXDbe//If+rkVd1HoWtrDpFbzDKDxCZmoOm8jYc6E+U+1nKcsRRrLQozTqJj2V9SeBcWh+i5nSC1BLAwQUAAAACABIUmhdiDdUXywAAAAJAQAADwAAAHNjb3Jlcy9oeW1uLnhtbLMpTs4vStUtSCwqKc8sTrWzAbF0czKLS/TtbBR1dRUOr1TQ1R2GTH00jwMAUEsDBBQAAAAIAEhSaF1xi/zpBwAAAAUAAAAJAAAAb3RoZXIueG1ss8nL17cDAFBLAQIUAxQAAAAIAEhSaF2fEQeaUQAAAGoAAAAWAAAAAAAAAAAAAACAAQAAAABNRVRBLUlORi9jb250YWluZXIueG1sUEsBAhQDFAAAAAgASFJoXYg3VF8sAAAACQEAAA8AAAAAAAAAAAAAAIABhQAAAHNjb3Jlcy9oeW1uLnhtbFBLAQIUAxQAAAAIAEhSaF1xi/zpBwAAAAUAAAAJAAAAAAAAAAAAAACAAd4AAABvdGhlci54bWxQSwUGAAAAAAMAAwC4AAAADAEAAAAA'
const STORED =
  'UEsDBBQAAAAAAEhSaF2fEQeaagAAAGoAAAAWAAAATUVUQS1JTkYvY29udGFpbmVyLnhtbDw/eG1sIHZlcnNpb249IjEuMCI/Pjxjb250YWluZXI+PHJvb3RmaWxlcz48cm9vdGZpbGUgZnVsbC1wYXRoPSJzY29yZXMvaHltbi54bWwiLz48L3Jvb3RmaWxlcz48L2NvbnRhaW5lcj5QSwMEFAAAAAAASFJoXYg3VF8JAQAACQEAAA8AAABzY29yZXMvaHltbi54bWw8c2NvcmUtcGFydHdpc2U+PHBhcnQtbGlzdC8+PCEtLSDDqSAtLT48IS0tIMOpIC0tPjwhLS0gw6kgLS0+PCEtLSDDqSAtLT48IS0tIMOpIC0tPjwhLS0gw6kgLS0+PCEtLSDDqSAtLT48IS0tIMOpIC0tPjwhLS0gw6kgLS0+PCEtLSDDqSAtLT48IS0tIMOpIC0tPjwhLS0gw6kgLS0+PCEtLSDDqSAtLT48IS0tIMOpIC0tPjwhLS0gw6kgLS0+PCEtLSDDqSAtLT48IS0tIMOpIC0tPjwhLS0gw6kgLS0+PCEtLSDDqSAtLT48IS0tIMOpIC0tPjwvc2NvcmUtcGFydHdpc2U+UEsDBBQAAAAAAEhSaF1xi/zpBQAAAAUAAAAJAAAAb3RoZXIueG1sPG5vLz5QSwECFAMUAAAAAABIUmhdnxEHmmoAAABqAAAAFgAAAAAAAAAAAAAAgAEAAAAATUVUQS1JTkYvY29udGFpbmVyLnhtbFBLAQIUAxQAAAAAAEhSaF2IN1RfCQEAAAkBAAAPAAAAAAAAAAAAAACAAZ4AAABzY29yZXMvaHltbi54bWxQSwECFAMUAAAAAABIUmhdcYv86QUAAAAFAAAACQAAAAAAAAAAAAAAgAHUAQAAb3RoZXIueG1sUEsFBgAAAAADAAMAuAAAAAACAAAAAA=='
const SCORE = `<score-partwise><part-list/>${'<!-- é -->'.repeat(20)}</score-partwise>`
const bytes = (base64: string) => Uint8Array.from(Buffer.from(base64, 'base64'))

describe('.mxl', () => {
  it('writes a zip that reads back to the same score, and is far smaller', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><score-partwise>${'<note><pitch><step>C</step></pitch></note>'.repeat(2000)} é ♯</score-partwise>`
    const mxl = await writeMxl(xml)
    assert.ok(isZip(mxl))
    assert.ok(mxl.length < xml.length / 10, `${mxl.length} of ${xml.length}`)
    assert.equal(await readMxl(mxl), xml)
  })

  it('writes the same bytes for the same score, whenever it is written', async () => {
    const a = await writeMxl(SCORE)
    await new Promise(resolve => setTimeout(resolve, 1100))
    assert.deepEqual(await writeMxl(SCORE), a)
  })

  it('reads the score container.xml names, in a zip another program made, deflated or stored', async () => {
    assert.equal(await readMxl(bytes(DEFLATED)), SCORE)
    assert.equal(await readMxl(bytes(STORED)), SCORE)
  })

  it('has no score in what is not an .mxl, or is cut short, or lies about its size', async () => {
    assert.equal(await readMxl(new TextEncoder().encode('<score-partwise/>')), null)
    assert.equal(await readMxl(new Uint8Array(0)), null)
    assert.equal(await readMxl(bytes(DEFLATED).subarray(0, 100)), null)
    // (damage to the score's own data; damage to container.xml falls back to the first XML file)
    const damaged = bytes(DEFLATED)
    damaged.fill(0xff, 150, 175)
    assert.equal(await readMxl(damaged), null)
    const noContainer = bytes(DEFLATED)
    noContainer.fill(0xff, 52, 80)
    assert.equal(await readMxl(noContainer), SCORE)
    // a score that inflates past the limit is refused as it inflates, whatever its header says
    const bomb = await writeMxl('a'.repeat(17 * 1024 * 1024))
    assert.ok(bomb.length < 100 * 1024)
    assert.equal(await readMxl(bomb), null)
  })

  it('reads a melody file in either form, and drops a byte order mark', async () => {
    assert.equal(await readMelodyFile(await writeMxl(SCORE)), SCORE)
    assert.equal(await readMelodyFile(new TextEncoder().encode(SCORE)), SCORE)
    assert.equal(await readMelodyFile(new TextEncoder().encode(`\uFEFF${SCORE}`)), SCORE)
  })
})

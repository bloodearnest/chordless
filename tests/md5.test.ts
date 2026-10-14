import { expect } from '@open-wc/testing'
import { md5Hex } from '../src/js/utils/md5.ts'

const { describe, it } = window

describe('md5Hex', () => {
  // From the MD5 spec and Python's hashlib, including the lengths either side of the padding
  // boundaries (55, 56 and 64 bytes) and multi-byte UTF-8
  const vectors: [string, string][] = [
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['The quick brown fox jumps over the lazy dog', '9e107d9d372bb6826bd81d3542a419d6'],
    ['1234567890'.repeat(8), '57edf4a22be3c955ac49da2e2107b67a'],
    ['Café — ♯ 🎸', '257cbf93d464ba6fcf112831e9f2434d'],
    ['a'.repeat(55), 'ef1772b6dff9a122358552954ad0df65'],
    ['a'.repeat(56), '3b0c8ac703f828b04c6c197006d17218'],
    ['a'.repeat(64), '014842d480b571495a4a0363793f7367'],
    ['a'.repeat(119), '8a7bd0732ed6a28ce75f6dabc90e1613'],
  ]

  for (const [text, hash] of vectors) {
    it(`hashes ${JSON.stringify(text.slice(0, 20))} (${text.length} chars)`, () => {
      expect(md5Hex(text)).to.equal(hash)
    })
  }
})

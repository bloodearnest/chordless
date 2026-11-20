/** ULIDs (src/js/ulid.ts): the ids of everything new */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { isUlid, shortId, ulid, ulidTail32 } from '../src/js/ulid.ts'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
/** A time well after any this run has used, so these tests do not depend on the order they run in */
const T0 = Date.now() + 10 * 365 * 24 * 3600 * 1000

describe('a ULID', () => {
  test('is 26 characters of Crockford’s base 32, and is one by `isUlid`', () => {
    const id = ulid()
    assert.equal(id.length, 26)
    assert.ok([...id].every(digit => ALPHABET.includes(digit)))
    assert.ok(isUlid(id))
  })

  test('holds the time in its first ten characters, most significant first', () => {
    const time = (id: string) =>
      [...id.slice(0, 10)].reduce((sum, digit) => sum * 32 + ALPHABET.indexOf(digit), 0)
    assert.equal(time(ulid(T0 + 1000)), T0 + 1000)
    assert.equal(time(ulid(T0 + 123_456_789)), T0 + 123_456_789)
  })

  test('sorts as text by when it was made', () => {
    const made = [3000, 1000, 5000, 2000, 4000].map(offset => ulid(T0 + 100_000 + offset))
    assert.deepEqual(
      [...made].sort(),
      [...made].sort((a, b) => a.slice(0, 10).localeCompare(b.slice(0, 10)))
    )
    // (made later, sorts later, whatever the random part is)
    const earlier = ulid(T0 + 300_000)
    const later = ulid(T0 + 300_001)
    assert.ok(earlier < later)
  })

  test('stays in order when several are made in one millisecond', () => {
    const same = Array.from({ length: 500 }, () => ulid(T0 + 400_000))
    assert.deepEqual([...same].sort(), same)
    assert.equal(new Set(same).size, 500)
  })

  test('stays in order when the clock steps back', () => {
    const first = ulid(T0 + 500_000)
    const after = ulid(T0 + 400_000)
    assert.ok(after > first)
  })

  test('is not made twice, by default: a thousand in a row, as fast as they can be, are in order', () => {
    const many = Array.from({ length: 1000 }, () => ulid())
    assert.deepEqual([...many].sort(), many)
    assert.equal(new Set(many).size, 1000)
  })
})

describe('what is and is not a ULID', () => {
  test('refuses a uuid, lower case, the wrong length, a letter Crockford leaves out, and a time that is too big', () => {
    assert.equal(isUlid('3f2a9c10-7b1e-4d55-9a6c-0e8f12345678'), false)
    assert.equal(isUlid(ulid().toLowerCase()), false)
    assert.equal(isUlid(ulid().slice(1)), false)
    assert.equal(isUlid(`${ulid()}0`), false)
    assert.equal(isUlid(`0${'I'.repeat(25)}`), false)
    assert.equal(isUlid(`0${'U'.repeat(25)}`), false)
    assert.equal(isUlid(`8${'0'.repeat(25)}`), false)
    assert.equal(isUlid(''), false)
    assert.equal(
      isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
      true,
      'the example in the ULID specification'
    )
  })

  test('has 32 bits of its random end as four bytes, and none for an id that is not one', () => {
    // 69G5FAV, read as base 32, keeping the low 32 bits
    const digits = [...'69G5FAV'].map(digit => ALPHABET.indexOf(digit))
    const bits = digits.reduce((sum, digit) => sum * 32n + BigInt(digit), 0n)
    const expected = Number(bits & 0xffffffffn)
    const tail = ulidTail32('01ARZ3NDEKTSV4RRFFQ69G5FAV') as Uint8Array
    assert.equal(tail.length, 4)
    assert.equal(((tail[0] << 24) | (tail[1] << 16) | (tail[2] << 8) | tail[3]) >>> 0, expected)
    assert.equal(ulidTail32('3f2a9c10-7b1e-4d55-9a6c-0e8f12345678'), null)
  })
})

describe('a short id', () => {
  test('is the first eight characters of a uuid or any other id, and the random end of a ULID', () => {
    assert.equal(shortId('3f2a9c10-7b1e-4d55-9a6c-0e8f12345678'), '3f2a9c10')
    assert.equal(shortId('title-amazing-grace'), 'titleama')
    assert.equal(shortId('01ARZ3NDEKTSV4RRFFQ69G5FAV'), 'Q69G5FAV')
  })

  test('tells apart ids made in the same minute, which start alike', () => {
    const made = Array.from({ length: 50 }, () => ulid())
    assert.equal(new Set(made.map(shortId)).size, 50)
  })
})

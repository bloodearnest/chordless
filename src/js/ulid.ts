/**
 * ULIDs: the ids of everything new (docs/SCHEMA_RULES.md, "Names and values"). 26 characters of Crockford's base 32: 48 bits of
 * the time in milliseconds, which sort as text by when the id was made (so inserts stay at the end of an index, and a
 * list sorts by age), then 80 random bits. Two made in one millisecond are still in order (the random part counts up),
 * and a clock that steps back does not put one before the last.
 *
 * An id is an opaque string: the uuids and other ids that are already stored stay as they are, and nothing may assume
 * the shape of one (`setlistCode` in share-crypto.ts is the one place that read a uuid's digits).
 * Written here, not a package, as docs/STORAGE_API.md and CLAUDE.md ask for few dependencies.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RANDOM_BITS = 80n
const MASK = (1n << RANDOM_BITS) - 1n

let lastTime = 0
let lastRandom = 0n

function randomBits(): bigint {
  let bits = 0n
  for (const byte of crypto.getRandomValues(new Uint8Array(10))) bits = (bits << 8n) | BigInt(byte)
  return bits
}

/** A new ULID. `now` is the clock, in milliseconds, for a test to give */
export function ulid(now: number = Date.now()): string {
  // (the same millisecond, or a clock that went back: the last time, and the next number after the last)
  if (now > lastTime) {
    lastTime = now
    lastRandom = randomBits()
  } else {
    lastRandom = (lastRandom + 1n) & MASK
  }
  let time = lastTime
  let text = ''
  for (let place = 0; place < 10; place++) {
    text = ALPHABET[time % 32] + text
    time = Math.floor(time / 32)
  }
  let random = lastRandom
  let tail = ''
  for (let place = 0; place < 16; place++) {
    tail = ALPHABET[Number(random & 31n)] + tail
    random >>= 5n
  }
  return text + tail
}

/** Whether an id is a ULID (the first digit is at most 7: the time is 48 bits) */
export const isUlid = (id: string): boolean => /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(id)

/**
 * 32 of the random bits of a ULID, as four bytes: what a short code for it is made of (the time is the same for
 * everything made in a minute, so the random end is what tells two ulids apart). Null for an id that is not one.
 */
export function ulidTail32(id: string): Uint8Array | null {
  if (!isUlid(id)) return null
  let bits = 0n
  for (const digit of id.slice(-7)) bits = (bits << 5n) | BigInt(ALPHABET.indexOf(digit))
  const low = Number(bits & 0xffffffffn)
  return Uint8Array.from([low >>> 24, (low >>> 16) & 255, (low >>> 8) & 255, low & 255])
}

/**
 * A few characters of an id, to tell files apart by name (`songs/amazing-grace-<these>.cho`): the first eight of a uuid or
 * any other id, but of a ULID its random end, because the first ten characters of one are the time, the same for every
 * id made in the same minute.
 */
export function shortId(id: string): string {
  const plain = id.replace(/[^A-Za-z0-9]/g, '')
  return isUlid(id) ? plain.slice(-8) : plain.slice(0, 8)
}

/**
 * Assert that a value is there, and narrow its type: `must(await db.getSong(id)).title`.
 * Chai's `expect(x).to.exist` checks at run time but does not tell the compiler.
 */
export function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what} to exist`)
  return value
}

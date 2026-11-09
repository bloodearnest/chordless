/** SVG path data to absolute coordinates, so the same shape written two ways (relative or absolute commands) compares equal */

export interface PathBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, Z: 0 }

/** Every number of the path as an absolute coordinate, in order, with the command letters upper-cased ("M0,-39,C..." as one string key) */
export function absolutePath(d: string): { key: string; box: PathBox; points: number[][] } {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? []
  let cmd = ''
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  const parts: string[] = []
  const points: number[][] = []
  const box: PathBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  const put = (px: number, py: number) => {
    points.push([px, py])
    box.minX = Math.min(box.minX, px)
    box.maxX = Math.max(box.maxX, px)
    box.minY = Math.min(box.minY, py)
    box.maxY = Math.max(box.maxY, py)
  }
  // The second control point of the last curve, for S, which mirrors it to make the first of the next
  let lastCtrl: [number, number] | null = null
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i] as string
    if (/[a-zA-Z]/.test(t)) {
      cmd = t
      i++
      if (t === 'z' || t === 'Z') {
        // A line back to the start before the close is the close
        if (parts[parts.length - 1] === `L${Math.round(sx * 10) / 10},${Math.round(sy * 10) / 10}`)
          parts.pop()
        parts.push('Z')
        x = sx
        y = sy
        continue
      }
    }
    const up = cmd.toUpperCase()
    const rel = cmd !== up
    const n = ARGS[up]
    if (n === undefined) throw new Error(`path command ${cmd}`)
    const a = tokens.slice(i, i + n).map(Number)
    i += n
    let abs: number[]
    if (up === 'H') abs = [rel ? x + (a[0] as number) : (a[0] as number), y]
    else if (up === 'V') abs = [x, rel ? y + (a[0] as number) : (a[0] as number)]
    else abs = a.map((v, k) => (rel ? v + (k % 2 === 0 ? x : y) : v))
    let letter = up === 'H' || up === 'V' ? 'L' : up
    if (up === 'S') {
      const c1: [number, number] = lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y]
      abs = [c1[0], c1[1], ...abs]
      letter = 'C'
    }
    lastCtrl = letter === 'C' ? [abs[2] as number, abs[3] as number] : null
    parts.push(letter + abs.map(v => Math.round(v * 10) / 10).join(','))
    for (let k = 0; k < abs.length; k += 2) put(abs[k] as number, abs[k + 1] as number)
    x = abs[abs.length - 2] as number
    y = abs[abs.length - 1] as number
    if (up === 'M') {
      sx = x
      sy = y
      cmd = rel ? 'l' : 'L'
    }
  }
  return { key: parts.join(' '), box, points }
}

/** A short stable hash of a canonical path (FNV-1a, in hex): the key of the glyph table */
export function shapeHash(key: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

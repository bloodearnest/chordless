/**
 * The frame monitor (src/js/telemetry/frames.ts): the frames that took 50 ms or more, measured only
 * while it runs, and the wait for a paint.
 */
import { expect } from '@open-wc/testing'
import { afterPaint, FrameMonitor, LONG_FRAME_MS } from '../src/js/telemetry/frames.ts'

const { describe, it, afterEach } = window

type Frame = (now: number) => void
const realRaf = window.requestAnimationFrame
const realCancel = window.cancelAnimationFrame
const realNow = performance.now.bind(performance)

/** Take over the frame clock: `tick(ms)` runs the waiting frame callback `ms` later than the last */
function fakeFrames() {
  let clock = 1000
  let waiting: Frame | null = null
  window.requestAnimationFrame = ((callback: Frame) => {
    waiting = callback
    return 1
  }) as typeof window.requestAnimationFrame
  window.cancelAnimationFrame = (() => {
    waiting = null
  }) as typeof window.cancelAnimationFrame
  performance.now = () => clock
  return {
    tick(ms: number) {
      clock += ms
      const callback = waiting
      waiting = null
      callback?.(clock)
    },
    get running() {
      return waiting !== null
    },
  }
}

afterEach(() => {
  window.requestAnimationFrame = realRaf
  window.cancelAnimationFrame = realCancel
  performance.now = realNow
})

describe('FrameMonitor', () => {
  it('counts the long frames, and the worst, from the second frame of a run', () => {
    const frames = fakeFrames()
    const monitor = new FrameMonitor(5000)
    monitor.start()
    frames.tick(16) // the first: nothing before it to measure from
    frames.tick(16)
    frames.tick(120)
    frames.tick(LONG_FRAME_MS)
    frames.tick(16)
    const { total, opening } = monitor.stop()
    expect(total).to.deep.equal({ frames: 4, long: 2, worstMs: 120, longMs: 120 + LONG_FRAME_MS })
    expect(opening).to.deep.equal(total)
  })

  it('keeps the first seconds apart from what comes after', () => {
    const frames = fakeFrames()
    const monitor = new FrameMonitor(200)
    monitor.start()
    frames.tick(16)
    frames.tick(100) // in the window
    monitor.arm(10_000)
    frames.tick(400) // the frame before it began after the window: not the opening's
    frames.tick(16)
    const { total, opening } = monitor.stop()
    expect(opening.long).to.equal(1)
    expect(total.long).to.equal(2)
    expect(total.worstMs).to.equal(400)
  })

  it('stops asking for frames once the run is over, and starts again when asked', () => {
    const frames = fakeFrames()
    const monitor = new FrameMonitor(100)
    monitor.start()
    frames.tick(16)
    expect(frames.running).to.equal(true)
    frames.tick(200) // past the window
    expect(frames.running).to.equal(false)
    monitor.arm()
    expect(frames.running).to.equal(true)
    // (a new run: the pause is not a frame)
    frames.tick(5000)
    frames.tick(16)
    expect(monitor.stop().total.long).to.equal(1)
  })

  it('does not count the wait for a hidden page as a stall', () => {
    const frames = fakeFrames()
    const hidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')
    const monitor = new FrameMonitor(100_000)
    monitor.start()
    frames.tick(16)
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    try {
      frames.tick(16)
      frames.tick(30_000) // (the page was put away for this long)
    } finally {
      delete (document as { hidden?: boolean }).hidden
      if (hidden) Object.defineProperty(Document.prototype, 'hidden', hidden)
    }
    frames.tick(16)
    frames.tick(16)
    expect(monitor.stop().total).to.deep.equal({ frames: 1, long: 0, worstMs: 0, longMs: 0 })
  })

  it('does nothing once stopped', () => {
    const frames = fakeFrames()
    const monitor = new FrameMonitor(1000)
    monitor.start()
    monitor.stop()
    monitor.arm()
    expect(frames.running).to.equal(false)
  })
})

describe('afterPaint', () => {
  it('says when the frame after the next came', async () => {
    const before = performance.now()
    const at = await afterPaint()
    expect(at).to.be.a('number')
    expect(at as number).to.be.at.least(before)
  })

  it('is null if no frame comes', async () => {
    window.requestAnimationFrame = (() => 1) as typeof window.requestAnimationFrame
    expect(await afterPaint(10)).to.equal(null)
  })
})

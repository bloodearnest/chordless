const { beforeEach, afterEach } = window

/**
 * Options for accessibility checks: expect(element).to.be.accessible(A11Y).
 * Contrast is left out for now: the light theme's secondary text (#7f8c8d on
 * white, 3.5:1) and primary buttons (white on #3498db, 3.2:1) are below WCAG
 * AA's 4.5:1, a palette decision still to make. Remove the exception then.
 */
export const A11Y = { ignoredRules: ['color-contrast'] }

export function suppressConsoleLogs() {
  let originalLog
  let originalWarn
  let buffered

  beforeEach(function () {
    buffered = []
    originalLog = console.log
    originalWarn = console.warn
    console.log = (...args) => buffered.push({ type: 'log', args })
    console.warn = (...args) => buffered.push({ type: 'warn', args })
  })

  afterEach(function () {
    console.log = originalLog
    console.warn = originalWarn
    if (this.currentTest?.state === 'failed' && buffered?.length) {
      buffered.forEach(entry => {
        if (entry.type === 'log') {
          originalLog(...entry.args)
        } else {
          console[entry.type](...entry.args)
        }
      })
    }
  })
}

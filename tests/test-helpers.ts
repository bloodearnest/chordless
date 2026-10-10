const { beforeEach, afterEach } = window

/** Options for accessibility checks: expect(element).to.be.accessible(A11Y) */
export const A11Y = { ignoredRules: [] }

export function suppressConsoleLogs() {
  let originalLog
  let originalWarn
  let buffered

  beforeEach(() => {
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

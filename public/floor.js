// Loaded by index.html before anything else, as a classic script written for any browser: no
// modern syntax, since a browser that cannot parse it is the one it is for. If the browser is
// below the floor (.browserslistrc: iOS/Safari 17.4, Chrome/Edge 120), say so plainly, instead
// of whatever happens when the app meets syntax or APIs it lacks, and stop the page loading the
// app. "Try it anyway" is remembered on this device: a wrong guess must never lock someone out.
// What it tests is what the floor guarantees: scrollend (Safari 17.4, Chrome 114), :has() and
// structuredClone (Safari 15.4, Chrome 105/98), so scrollend is the one that sets the floor.
;(function () {
  var KEY = 'chordless-open-below-floor'

  function ok() {
    try {
      return (
        'onscrollend' in window &&
        typeof structuredClone === 'function' &&
        !!window.CSS &&
        typeof CSS.supports === 'function' &&
        CSS.supports('selector(:has(*))')
      )
    } catch (_error) {
      return false
    }
  }

  function remembered() {
    try {
      return localStorage.getItem(KEY) === '1'
    } catch (_error) {
      return false
    }
  }

  if (ok() || remembered()) return
  window.chordlessBelowFloor = true
  try {
    window.stop()
  } catch (_error) {
    // nothing to stop
  }

  function show() {
    var box = document.createElement('div')
    box.setAttribute('role', 'alert')
    box.style.cssText =
      'font: 18px/1.5 system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem;'
    var heading = document.createElement('h1')
    heading.textContent = 'Please update your device'
    heading.style.fontSize = '1.5rem'
    var text = document.createElement('p')
    text.textContent =
      'Chordless needs a newer browser than this one: Safari on iOS or iPadOS 17.4 or later, ' +
      'or Chrome or Edge 120 or later. On an iPhone or iPad, update in Settings > General > ' +
      'Software Update, then open Chordless again. Your setlists are kept.'
    var button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'Try it anyway'
    button.style.cssText = 'font: inherit; padding: 0.5rem 1rem; min-height: 44px'
    button.onclick = function () {
      try {
        localStorage.setItem(KEY, '1')
      } catch (_error) {
        // nothing to stop
      }
      location.reload()
    }
    box.appendChild(heading)
    box.appendChild(text)
    box.appendChild(button)
    var body = document.body || document.documentElement
    body.innerHTML = ''
    body.appendChild(box)
  }

  if (document.body) show()
  else document.addEventListener('DOMContentLoaded', show)
})()

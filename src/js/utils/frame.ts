/**
 * The app is a tablet-sized frame centred in a wide window (see --app-width in style.css), with
 * a border either side. Popups are placed against the viewport, so they keep inside the
 * frame's edges and not the window's.
 */
export function frameBounds(): { left: number; right: number } {
  const { left, right } = document.body.getBoundingClientRect()
  return { left, right }
}

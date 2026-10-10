import '/components/icon.ts'
import '/js/icons.ts'

const container = document.getElementById('icon-container')

// Group icons by category
const categories = {
  'Media Controls': ['play', 'pause', 'stop', 'skip-next', 'skip-previous'],
  'UI Controls': ['settings', 'edit', 'info', 'close', 'menu'],
  Navigation: ['chevron-left', 'chevron-right', 'chevron-up', 'chevron-down'],
  Actions: ['add', 'remove', 'check', 'delete'],
  Content: ['search', 'share'],
}

// Render each category
for (const [category, iconNames] of Object.entries(categories)) {
  const section = document.createElement('div')
  section.className = 'section'

  const title = document.createElement('h2')
  title.className = 'section-title'
  title.textContent = category
  section.appendChild(title)

  const grid = document.createElement('div')
  grid.className = 'icon-grid'

  iconNames.forEach(iconName => {
    const item = document.createElement('div')
    item.className = 'icon-item'

    // Show different sizes
    const sizes = document.createElement('div')
    sizes.className = 'icon-sizes'

    ;[16, 24, 32].forEach(size => {
      const icon = document.createElement('app-icon')
      icon.setAttribute('name', iconName)
      icon.setAttribute('size', size)
      sizes.appendChild(icon)
    })

    const name = document.createElement('div')
    name.className = 'icon-name'
    name.textContent = iconName

    const label = document.createElement('div')
    label.className = 'size-label'
    label.textContent = '16 / 24 / 32'

    item.appendChild(sizes)
    item.appendChild(name)
    item.appendChild(label)
    grid.appendChild(item)
  })

  section.appendChild(grid)
  container.appendChild(section)
}

// Theme toggle
window.toggleTheme = () => {
  document.body.classList.toggle('dark-mode')
}

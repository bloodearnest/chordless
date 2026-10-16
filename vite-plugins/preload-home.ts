import type { HtmlTagDescriptor, Plugin } from 'vite'

/**
 * Preload the home view's code with the shell. The router picks the view only once the entry
 * module has run, so on a first visit (the home page, with nothing in the library yet) its files
 * would otherwise be a second round of requests after the first. Vite preloads only what the
 * entry imports statically; this adds the home view's chunk and what that imports in turn.
 * Later visits find the files in the service worker's cache, so it costs them next to nothing.
 */
export function preloadHome(): Plugin {
  return {
    name: 'chordless:preload-home',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle
        if (!bundle) return
        const chunks = Object.values(bundle).flatMap(item => (item.type === 'chunk' ? [item] : []))
        const home = chunks.find(chunk => chunk.facadeModuleId?.endsWith('/views/home-view.ts'))
        if (!home) throw new Error('preload-home: no chunk for views/home-view.ts')

        const wanted = new Set<string>()
        const visit = (name: string) => {
          if (wanted.has(name)) return
          wanted.add(name)
          const chunk = bundle[name]
          if (chunk?.type === 'chunk') chunk.imports.forEach(visit)
        }
        visit(home.fileName)

        const tags: HtmlTagDescriptor[] = []
        for (const name of wanted) {
          // (already named in the page: the entry and what it imports)
          if (html.includes(`/${name}"`)) continue
          tags.push({
            tag: 'link',
            attrs: { rel: 'modulepreload', crossorigin: true, href: `/${name}` },
            injectTo: 'head',
          })
        }
        return tags
      },
    },
  }
}

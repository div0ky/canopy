import path from 'node:path'

function routeForFile(root, collection, file) {
  const relative = path.relative(path.join(root, collection), file).replaceAll(path.sep, '/')
  if (relative.startsWith('../')) return undefined

  const withoutExtension = relative.replace(/\.md$/u, '')
  const slug = withoutExtension === 'index' ? '' : withoutExtension.replace(/\/index$/u, '')
  return `/${collection}${slug ? `/${slug}` : ''}`
}

function visit(node, transform) {
  if (!node || typeof node !== 'object') return
  transform(node)
  if (Array.isArray(node.children)) {
    for (const child of node.children) visit(child, transform)
  }
}

export function remarkWebsiteLinks({ root }) {
  return (tree, file) => {
    const source = file.path
    if (!source) return

    visit(tree, (node) => {
      if (node.type !== 'link' || typeof node.url !== 'string') return
      if (/^(?:[a-z]+:|#|\/)/iu.test(node.url)) return

      const [pathname, hash] = node.url.split('#', 2)
      if (!pathname?.endsWith('.md')) return

      const target = path.resolve(path.dirname(source), pathname)
      const route = routeForFile(root, 'docs', target) ?? routeForFile(root, 'manifesto', target)
      if (!route) return

      node.url = `${route}${hash ? `#${hash}` : ''}`
    })
  }
}

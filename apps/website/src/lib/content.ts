import type { CollectionEntry } from 'astro:content'

export type DocumentationEntry = CollectionEntry<'docs'> | CollectionEntry<'manifesto'>

const docsOrder = [
  'index',
  'getting-started',
  'concepts/application-model',
  'guides/events-jobs-schedules',
  'operations/deployment',
  'reference/packages',
  'upgrading',
]

const foundationsOrder = [
  'index',
  'principles',
  'architecture',
  'mvp',
  'security',
  'specifications',
]

export function entryTitle(entry: DocumentationEntry): string {
  const heading = entry.body?.match(/^#\s+(.+)$/mu)?.[1]?.trim()
  return heading?.replaceAll(/[`*_]/gu, '') ?? humanize(entry.id.split('/').at(-1) ?? entry.id)
}

export function entrySummary(entry: DocumentationEntry): string {
  const body = entry.body ?? ''
  const withoutTitle = body.replace(/^#\s+.+$/mu, '').trim()
  const blocks = withoutTitle.split(/\n\s*\n/u)
  const paragraph =
    blocks.find((block) => {
      const candidate = block.trim()
      return (
        candidate.length > 40 &&
        !candidate.startsWith('#') &&
        !candidate.startsWith('```') &&
        !candidate.startsWith('|')
      )
    }) ??
    blocks[0] ??
    ''
  return paragraph
    .replaceAll(/\[([^\]]+)\]\([^\)]+\)/gu, '$1')
    .replaceAll(/[`*_>#]/gu, '')
    .replaceAll(/\s+/gu, ' ')
    .trim()
}

export function entryRoute(entry: DocumentationEntry): string {
  const slug = entry.id === 'index' ? '' : entry.id.replace(/\/index$/u, '')
  return `/${entry.collection}${slug ? `/${slug}` : ''}`
}

export function sortDocs(entries: CollectionEntry<'docs'>[]) {
  return entries
    .filter((entry) => docsOrder.includes(entry.id))
    .sort((left, right) => docsOrder.indexOf(left.id) - docsOrder.indexOf(right.id))
}

export function docsNavigationLabel(entry: CollectionEntry<'docs'>) {
  const labels: Record<string, string> = {
    index: 'Overview',
    'getting-started': 'Getting started',
    'concepts/application-model': 'Application model',
    'guides/events-jobs-schedules': 'Events, jobs & schedules',
    'operations/deployment': 'Operations & deployment',
    'reference/packages': 'Package reference',
    upgrading: 'Upgrading',
  }
  return labels[entry.id] ?? entryTitle(entry)
}

export function manifestoNavigationLabel(entry: CollectionEntry<'manifesto'>) {
  const labels: Record<string, string> = {
    index: 'Manifesto',
    principles: 'Principles',
    architecture: 'Architecture',
    mvp: 'MVP viability',
    security: 'Security model',
    specifications: 'Specification roadmap',
  }
  return labels[entry.id] ?? entryTitle(entry)
}

export function sortFoundations(entries: CollectionEntry<'manifesto'>[]) {
  return [...entries]
    .filter((entry) => foundationsOrder.includes(entry.id))
    .sort((left, right) => foundationsOrder.indexOf(left.id) - foundationsOrder.indexOf(right.id))
}

export function manifestoGroup(entries: CollectionEntry<'manifesto'>[], prefix: string) {
  return [...entries]
    .filter(
      (entry) =>
        entry.id.startsWith(`${prefix}/`) || (prefix !== 'specifications' && entry.id === prefix),
    )
    .sort((left, right) => left.id.localeCompare(right.id, 'en', { numeric: true }))
}

function humanize(value: string) {
  return value
    .replace(/^\d+-?/u, '')
    .replaceAll('-', ' ')
    .replace(/^./u, (letter) => letter.toUpperCase())
}

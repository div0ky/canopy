import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const roots = ['README.md', 'manifesto']
const files = []
for (const root of roots) files.push(...await markdownFiles(root))
const missing = []
for (const file of files) {
  const source = await readFile(file, 'utf8')
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, '')
    if (!raw || raw.startsWith('#') || /^[a-z]+:/i.test(raw)) continue
    const target = decodeURIComponent(raw.split('#', 1)[0])
    try { await access(path.resolve(path.dirname(file), target)) }
    catch { missing.push(`${file}: missing ${raw}`) }
  }
}
if (missing.length > 0) {
  console.error(missing.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Documentation link audit passed for ${files.length} Markdown files.`)
}

async function markdownFiles(target) {
  if (target.endsWith('.md')) return [target]
  const files = []
  for (const entry of await readdir(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name)
    if (entry.isDirectory()) files.push(...await markdownFiles(child))
    else if (entry.isFile() && child.endsWith('.md')) files.push(child)
  }
  return files
}

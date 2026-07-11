import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const roots = ['examples/reference-app/src', 'examples/persistence-app/src']
const forbidden = [
  /^hono(?:\/|$)/,
  /^drizzle-orm(?:\/|$)/,
  /^pg-boss(?:\/|$)/,
  /^@opentelemetry(?:\/|$)/,
  /^@sendgrid(?:\/|$)/,
  /^twilio(?:\/|$)/,
  /^better-auth(?:\/|$)/,
  /^@prisma(?:\/|$)/,
]
const violations = []

for (const root of roots) {
  for (const file of await sourceFiles(root)) {
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const specifier = match[1] ?? match[2]
      if (forbidden.some((pattern) => pattern.test(specifier))) violations.push(`${file}: forbidden application dependency ${specifier}`)
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Application boundary audit passed for ${roots.join(', ')}.`)
}

async function sourceFiles(root) {
  const files = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(target))
    else if (entry.isFile() && target.endsWith('.ts')) files.push(target)
  }
  return files
}

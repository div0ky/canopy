import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const roots = [
  '.changeset/README.md',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'GOVERNANCE.md',
  'MAINTAINERS.md',
  'README.md',
  'SECURITY.md',
  'SUPPORT.md',
  'docs',
  'examples',
  'manifesto',
  'packages',
]
const files = []
for (const root of roots) files.push(...(await markdownFiles(root)))
const missing = []
const sources = new Map()
for (const file of files) {
  const source = await readFile(file, 'utf8')
  sources.set(file, source)
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, '')
    if (!raw || raw.startsWith('#') || /^[a-z]+:/i.test(raw)) continue
    const target = decodeURIComponent(raw.split('#', 1)[0])
    try {
      await access(path.resolve(path.dirname(file), target))
    } catch {
      missing.push(`${file}: missing ${raw}`)
    }
  }
}
const inconsistent = await securityStatusProblems(sources)
const problems = [...missing, ...inconsistent]
if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Documentation link audit passed for ${files.length} Markdown files.`)
}

async function securityStatusProblems(sources) {
  const securityPath = path.join('manifesto', 'security.md')
  const ledgerPath = path.join('manifesto', 'implementation', 'mvp-completion-ledger.md')
  const specificationsPath = path.join('manifesto', 'specifications.md')
  const security = sources.get(securityPath) ?? ''
  const auditLink = security.match(
    /\[[^\]]*framework security audit\]\((implementation\/security-audit-[^)]+\.md)\)/,
  )?.[1]
  if (!auditLink) return ['manifesto/security.md: current framework security audit link is missing']

  const auditPath = path.join('manifesto', auditLink)
  const audit = sources.get(auditPath) ?? (await readFile(auditPath, 'utf8'))
  const ledger = sources.get(ledgerPath) ?? ''
  const specifications = sources.get(specificationsPath) ?? ''
  const result = audit.match(/\*\*Result:\*\* ([^\n]+)/)?.[1]
  if (!result) return [`${auditPath}: security audit result is missing`]

  const auditBlocked = result === 'Not security-release-ready'
  const ledgerBlocked =
    ledger.includes('public security-stability claim blocked') &&
    ledger.includes('Complete (release blocked)')
  const specificationsBlocked = specifications.includes('block a public security-stability claim')
  if (!auditBlocked) {
    return [
      ...(ledgerBlocked
        ? [
            'manifesto/implementation/mvp-completion-ledger.md: blocked aggregate status no longer matches the current security audit',
          ]
        : []),
      ...(specificationsBlocked
        ? [
            'manifesto/specifications.md: blocked specification status no longer matches the current security audit',
          ]
        : []),
    ]
  }

  return [
    ...(ledgerBlocked
      ? []
      : [
          'manifesto/implementation/mvp-completion-ledger.md: current security release blockers are not reflected in the aggregate status',
        ]),
    ...(specificationsBlocked
      ? []
      : [
          'manifesto/specifications.md: current security release blockers are not reflected in the specification status',
        ]),
  ]
}

async function markdownFiles(target) {
  if (target.endsWith('.md')) return [target]
  const files = []
  for (const entry of await readdir(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name)
    if (entry.isDirectory()) files.push(...(await markdownFiles(child)))
    else if (entry.isFile() && child.endsWith('.md')) files.push(child)
  }
  return files
}

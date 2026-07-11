import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const applicationRoots = [
  'examples/reference-app/src',
  'examples/persistence-app/src',
  'examples/field-guide/src',
]
const forbiddenApplicationDependencies = [
  /^hono(?:\/|$)/,
  /^drizzle-orm(?:\/|$)/,
  /^pg-boss(?:\/|$)/,
  /^@opentelemetry(?:\/|$)/,
  /^@sendgrid(?:\/|$)/,
  /^twilio(?:\/|$)/,
  /^better-auth(?:\/|$)/,
  /^@prisma(?:\/|$)/,
]
const forbiddenDeclarationDependencies = [
  /^hono(?:\/|$)/,
  /^@hono(?:\/|$)/,
  /^drizzle-orm(?:\/|$)/,
  /^drizzle-kit(?:\/|$)/,
  /^pg(?:\/|$)/,
  /^pg-boss(?:\/|$)/,
  /^typescript(?:\/|$)/,
  /^@sendgrid(?:\/|$)/,
  /^twilio(?:\/|$)/,
]
const allowedCanopyDependencies = new Map(
  Object.entries({
    '@canopy/core': [],
    '@canopy/manifest': [],
    '@canopy/compiler': ['@canopy/manifest'],
    '@canopy/runtime': ['@canopy/core', '@canopy/manifest'],
    '@canopy/http-hono': ['@canopy/core', '@canopy/runtime'],
    '@canopy/postgres-drizzle': ['@canopy/core'],
    '@canopy/auth-postgres': ['@canopy/core'],
    '@canopy/queue-pg-boss': ['@canopy/core'],
    '@canopy/sendgrid': ['@canopy/core'],
    '@canopy/twilio-sms': ['@canopy/core'],
    '@canopy/testing': ['@canopy/core', '@canopy/http-hono', '@canopy/runtime'],
    '@canopy/undergrowth': ['@canopy/core'],
    '@canopy/arbor': [
      '@canopy/auth-postgres',
      '@canopy/compiler',
      '@canopy/core',
      '@canopy/http-hono',
      '@canopy/postgres-drizzle',
      '@canopy/queue-pg-boss',
      '@canopy/runtime',
      '@canopy/undergrowth',
    ],
  }),
)
const violations = []
const packageRecords = await loadPackages()
const packagesByName = new Map(packageRecords.map((record) => [record.packageJson.name, record]))
const generatedApplicationDependencies = new Set([
  '@canopy/auth-postgres',
  '@canopy/postgres-drizzle',
])

for (const applicationRoot of applicationRoots) {
  for (const file of await sourceFiles(path.join(root, applicationRoot))) {
    for (const specifier of imports(await readFile(file, 'utf8'))) {
      if (forbiddenApplicationDependencies.some((pattern) => pattern.test(specifier))) {
        violations.push(`${relative(file)}: forbidden application dependency ${specifier}`)
      }
    }
  }
}

for (const record of packageRecords) {
  const packageName = record.packageJson.name
  const allowed = new Set(allowedCanopyDependencies.get(packageName) ?? [])
  const declared = {
    ...record.packageJson.dependencies,
    ...record.packageJson.optionalDependencies,
    ...record.packageJson.peerDependencies,
  }
  for (const dependency of Object.keys(declared).filter((name) => name.startsWith('@canopy/'))) {
    if (!allowed.has(dependency)) {
      violations.push(
        `${relative(record.directory)}/package.json: forbidden edge ${packageName} -> ${dependency}`,
      )
    }
  }

  for (const file of await sourceFiles(path.join(record.directory, 'src'))) {
    for (const specifier of imports(await readFile(file, 'utf8'))) {
      if (specifier.startsWith('@canopy/')) {
        const [scope, segment, ...subpath] = specifier.split('/')
        const targetName = `${scope}/${segment}`
        const target = packagesByName.get(targetName)
        if (!target) {
          violations.push(`${relative(file)}: unknown Canopy package ${targetName}`)
          continue
        }
        if (!allowed.has(targetName)) {
          violations.push(
            `${relative(file)}: forbidden source edge ${packageName} -> ${targetName}`,
          )
        }
        const generatedDependency =
          packageName === '@canopy/arbor' && generatedApplicationDependencies.has(targetName)
        if (!(targetName in declared) && !generatedDependency) {
          violations.push(
            `${relative(file)}: ${targetName} is imported but not a runtime dependency`,
          )
        }
        const exportKey = subpath.length === 0 ? '.' : `./${subpath.join('/')}`
        if (!(exportKey in (target.packageJson.exports ?? {}))) {
          violations.push(`${relative(file)}: ${specifier} is not a declared package export`)
        }
      } else if (specifier.startsWith('../')) {
        const resolved = path.resolve(path.dirname(file), specifier)
        if (!resolved.startsWith(`${record.directory}${path.sep}`)) {
          violations.push(`${relative(file)}: relative import crosses the package boundary`)
        }
      }
    }
  }

  for (const file of await publicDeclarationFiles(record)) {
    for (const specifier of imports(await readFile(file, 'utf8'))) {
      if (forbiddenDeclarationDependencies.some((pattern) => pattern.test(specifier))) {
        violations.push(
          `${relative(file)}: vendor type leaked through public declarations: ${specifier}`,
        )
      }
    }
  }
}

async function publicDeclarationFiles(record) {
  const targets = Object.values(record.packageJson.exports ?? {})
    .map((entry) => (typeof entry === 'object' && entry !== null ? entry.types : undefined))
    .filter((entry) => typeof entry === 'string')
    .map((entry) => path.resolve(record.directory, entry))
  const discovered = new Set()
  const pending = [...targets]
  while (pending.length > 0) {
    const file = pending.pop()
    if (discovered.has(file)) continue
    let source
    try {
      source = await readFile(file, 'utf8')
    } catch {
      continue
    }
    discovered.add(file)
    for (const specifier of imports(source).filter((entry) => entry.startsWith('.'))) {
      const target = path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.d.ts'))
      if (!discovered.has(target)) pending.push(target)
    }
  }
  return [...discovered]
}

detectCycles()

if (violations.length > 0) {
  console.error(violations.join('\n'))
  process.exitCode = 1
} else {
  console.log(
    `Architecture boundary audit passed for ${applicationRoots.length} applications and ${packageRecords.length} packages.`,
  )
}

async function loadPackages() {
  const packagesRoot = path.join(root, 'packages')
  const entries = await readdir(packagesRoot, { withFileTypes: true })
  return await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const directory = path.join(packagesRoot, entry.name)
        const packageJson = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
        return { directory, packageJson }
      }),
  )
}

function detectCycles() {
  const visiting = new Set()
  const visited = new Set()
  const visit = (name, trail) => {
    if (visiting.has(name)) {
      violations.push(`Canopy package dependency cycle: ${[...trail, name].join(' -> ')}`)
      return
    }
    if (visited.has(name)) return
    visiting.add(name)
    for (const dependency of allowedCanopyDependencies.get(name) ?? []) {
      const record = packagesByName.get(name)
      const declared = {
        ...record?.packageJson.dependencies,
        ...record?.packageJson.optionalDependencies,
        ...record?.packageJson.peerDependencies,
      }
      if (dependency in declared) visit(dependency, [...trail, name])
    }
    visiting.delete(name)
    visited.add(name)
  }
  for (const name of packagesByName.keys()) visit(name, [])
}

function imports(source) {
  return [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map((match) => match[1] ?? match[2])
    .filter(Boolean)
}

async function sourceFiles(directory) {
  return await filesMatching(directory, (target) => /\.tsx?$/.test(target))
}

async function filesMatching(directory, predicate) {
  const files = []
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return files
  }
  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await filesMatching(target, predicate)))
    else if (entry.isFile() && predicate(target)) files.push(target)
  }
  return files
}

function relative(target) {
  return path.relative(root, target)
}

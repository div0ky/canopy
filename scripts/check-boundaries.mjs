import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

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
const allowedDoxaDependencies = new Map(
  Object.entries({
    '@doxajs/core': [],
    '@doxajs/manifest': [],
    '@doxajs/introspection': ['@doxajs/manifest'],
    '@doxajs/gnosis': ['@doxajs/introspection', '@doxajs/manifest'],
    '@doxajs/compiler': ['@doxajs/manifest'],
    '@doxajs/runtime': ['@doxajs/core', '@doxajs/manifest'],
    '@doxajs/http-hono': ['@doxajs/core', '@doxajs/runtime'],
    '@doxajs/keryx': ['@doxajs/core'],
    '@doxajs/realtime': [],
    '@doxajs/postgres-drizzle': ['@doxajs/core'],
    '@doxajs/auth-postgres': ['@doxajs/core'],
    '@doxajs/queue-pg-boss': ['@doxajs/core'],
    '@doxajs/sendgrid': ['@doxajs/core'],
    '@doxajs/twilio-sms': ['@doxajs/core'],
    '@doxajs/testing': ['@doxajs/core', '@doxajs/http-hono', '@doxajs/runtime'],
    '@doxajs/theoria': ['@doxajs/core'],
    '@doxajs/praxis': [
      '@doxajs/auth-postgres',
      '@doxajs/compiler',
      '@doxajs/core',
      '@doxajs/gnosis',
      '@doxajs/http-hono',
      '@doxajs/introspection',
      '@doxajs/postgres-drizzle',
      '@doxajs/queue-pg-boss',
      '@doxajs/runtime',
      '@doxajs/theoria',
    ],
  }),
)
const violations = []
const packageRecords = await loadPackages()
const packagesByName = new Map(packageRecords.map((record) => [record.packageJson.name, record]))
const generatedApplicationDependencies = new Set([
  '@doxajs/auth-postgres',
  '@doxajs/postgres-drizzle',
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
  const allowed = new Set(allowedDoxaDependencies.get(packageName) ?? [])
  const declared = {
    ...record.packageJson.dependencies,
    ...record.packageJson.optionalDependencies,
    ...record.packageJson.peerDependencies,
  }
  for (const dependency of Object.keys(declared).filter((name) => name.startsWith('@doxajs/'))) {
    if (!allowed.has(dependency)) {
      violations.push(
        `${relative(record.directory)}/package.json: forbidden edge ${packageName} -> ${dependency}`,
      )
    }
  }

  for (const file of await sourceFiles(path.join(record.directory, 'src'))) {
    for (const specifier of imports(await readFile(file, 'utf8'))) {
      if (specifier.startsWith('@doxajs/')) {
        const [scope, segment, ...subpath] = specifier.split('/')
        const targetName = `${scope}/${segment}`
        const target = packagesByName.get(targetName)
        if (!target) {
          violations.push(`${relative(file)}: unknown Doxa package ${targetName}`)
          continue
        }
        if (!allowed.has(targetName)) {
          violations.push(
            `${relative(file)}: forbidden source edge ${packageName} -> ${targetName}`,
          )
        }
        const generatedDependency =
          packageName === '@doxajs/praxis' && generatedApplicationDependencies.has(targetName)
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
      violations.push(`Doxa package dependency cycle: ${[...trail, name].join(' -> ')}`)
      return
    }
    if (visited.has(name)) return
    visiting.add(name)
    for (const dependency of allowedDoxaDependencies.get(name) ?? []) {
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
  const sourceFile = ts.createSourceFile('boundary.ts', source, ts.ScriptTarget.Latest, true)
  const specifiers = []
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
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

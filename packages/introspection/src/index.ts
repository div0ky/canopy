import { createHash } from 'node:crypto'

import {
  assertManifest,
  canonicalJson,
  type DoxaManifest,
  type ModelManifestEntry,
} from '@doxajs/manifest'

export const INTROSPECTION_SCHEMA_VERSION = 1 as const
export const GNOSIS_KNOWLEDGE_SCHEMA_VERSION = 2 as const
export const MAX_INSPECTION_RESULTS = 100
export const MAX_INSPECTION_OBJECT_PROPERTIES = 100

export type InspectionSurface =
  | 'actions'
  | 'commands'
  | 'events'
  | 'jobs'
  | 'listeners'
  | 'models'
  | 'observers'
  | 'policies'
  | 'queries'
  | 'routes'
  | 'schedules'

export type IntrospectionErrorCode =
  'invalid_manifest' | 'stale_manifest' | 'not_found' | 'invalid_input'

export class IntrospectionError extends Error {
  override readonly name = 'IntrospectionError'

  constructor(
    readonly code: IntrospectionErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export interface ApplicationInfo {
  readonly schemaVersion: typeof INTROSPECTION_SCHEMA_VERSION
  readonly applicationId: string
  readonly frameworkVersion: string
  readonly compilerVersion: string
  readonly manifestFormatVersion: number
  readonly buildHash: string
  readonly plugins: readonly string[]
}

export interface GraphInspection {
  readonly schemaVersion: typeof INTROSPECTION_SCHEMA_VERSION
  readonly applicationId: string
  readonly buildHash: string
  readonly counts: Readonly<Record<string, number>>
}

export interface BoundedInspection<T> {
  readonly items: readonly T[]
  readonly total: number
  readonly truncated: boolean
}

export interface GnosisKnowledge {
  readonly schemaVersion: typeof GNOSIS_KNOWLEDGE_SCHEMA_VERSION
  readonly framework: 'Doxa'
  readonly applicationId: string
  readonly buildHash: string
  readonly application: ApplicationInfo
  readonly graph: GraphInspection
  readonly principles: readonly string[]
  readonly conventions: Readonly<Record<string, string>>
  readonly roles: Readonly<Record<string, unknown>>
  readonly theoria: Readonly<Record<string, unknown>>
  readonly deployment: Readonly<Record<string, unknown>>
  readonly praxis: Readonly<Record<string, readonly string[]>>
}

const surfaces: Readonly<Record<InspectionSurface, keyof DoxaManifest>> = {
  actions: 'actions',
  commands: 'commands',
  events: 'events',
  jobs: 'jobs',
  listeners: 'listeners',
  models: 'models',
  observers: 'observers',
  policies: 'policies',
  queries: 'queries',
  routes: 'routes',
  schedules: 'schedules',
}

const graphSections = [
  'features',
  'configurations',
  'providers',
  'models',
  'observers',
  'actions',
  'queries',
  'routes',
  'events',
  'listeners',
  'signals',
  'signalHandlers',
  'jobs',
  'schedules',
  'policies',
  'commands',
] as const satisfies readonly (keyof DoxaManifest)[]

export function assertCurrentManifest(value: unknown): asserts value is DoxaManifest {
  try {
    assertManifest(value)
  } catch (error) {
    throw new IntrospectionError('invalid_manifest', safeErrorMessage(error))
  }
  const { buildHash, ...semanticManifest } = value
  const actual = createHash('sha256').update(canonicalJson(semanticManifest)).digest('hex')
  if (actual !== buildHash) {
    throw new IntrospectionError(
      'stale_manifest',
      'The Doxa manifest content does not match its build hash. Run doxa build again.',
    )
  }
}

export function applicationInfo(manifest: DoxaManifest): ApplicationInfo {
  assertCurrentManifest(manifest)
  return Object.freeze({
    schemaVersion: INTROSPECTION_SCHEMA_VERSION,
    applicationId: manifest.applicationId,
    frameworkVersion: manifest.frameworkVersion,
    compilerVersion: manifest.compilerVersion,
    manifestFormatVersion: manifest.formatVersion,
    buildHash: manifest.buildHash,
    plugins: Object.freeze(manifest.plugins.map((plugin) => plugin.package).sort()),
  })
}

export function inspectGraph(manifest: DoxaManifest): GraphInspection {
  assertCurrentManifest(manifest)
  return Object.freeze({
    schemaVersion: INTROSPECTION_SCHEMA_VERSION,
    applicationId: manifest.applicationId,
    buildHash: manifest.buildHash,
    counts: Object.freeze(
      Object.fromEntries(
        graphSections.map((section) => [
          section,
          Array.isArray(manifest[section]) ? manifest[section].length : 0,
        ]),
      ),
    ),
  })
}

export function inspectSurface(
  manifest: DoxaManifest,
  surface: InspectionSurface,
): BoundedInspection<Readonly<Record<string, unknown>>> {
  assertCurrentManifest(manifest)
  const entries = manifest[surfaces[surface]] as readonly unknown[]
  const items = entries
    .map((entry) => sanitizeInspectionValue(entry) as Readonly<Record<string, unknown>>)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .slice(0, MAX_INSPECTION_RESULTS)
  return Object.freeze({
    items: Object.freeze(items),
    total: entries.length,
    truncated: entries.length > items.length,
  })
}

export function describeModel(manifest: DoxaManifest, id: string): Readonly<ModelManifestEntry> {
  assertCurrentManifest(manifest)
  if (id.length === 0 || id.length > 256) {
    throw new IntrospectionError('invalid_input', 'Model ID must contain 1 through 256 characters.')
  }
  const model = manifest.models.find((entry) => entry.id === id)
  if (!model) throw new IntrospectionError('not_found', `Model ${id} is not declared.`)
  return sanitizeInspectionValue(model) as Readonly<ModelManifestEntry>
}

export function describeAuthentication(manifest: DoxaManifest): Readonly<Record<string, unknown>> {
  assertCurrentManifest(manifest)
  const authentication = manifest.authentication
  return Object.freeze({
    mode: authentication.mode,
    source: authentication.source,
    ...(authentication.modelId ? { modelId: authentication.modelId } : {}),
    table: authentication.table,
    identifier: Object.freeze({
      kind: authentication.identifier.kind,
      field: authentication.columns.identifier,
      normalization: authentication.identifier.normalization,
    }),
    ...(authentication.columns.contactEmail
      ? { contactEmail: authentication.columns.contactEmail }
      : {}),
    verification: authentication.verification,
    eligibility: Object.freeze(
      authentication.eligibility.map((predicate) =>
        Object.freeze({
          column: predicate.column,
          operation:
            'equals' in predicate
              ? 'equals'
              : 'in' in predicate
                ? 'in'
                : 'null' in predicate
                  ? 'null'
                  : 'notNull',
        }),
      ),
    ),
    hashers: Object.freeze(authentication.credentials.readers.map((reader) => reader.preset)),
    credentialOwnership:
      authentication.source === 'doxa-owned' ||
      authentication.credentials.write.destination === 'sidecar'
        ? 'doxa'
        : 'external',
    routes: authentication.routes,
  })
}

export function safeManifest(manifest: DoxaManifest): Readonly<Record<string, unknown>> {
  assertCurrentManifest(manifest)
  const sanitized = sanitizeInspectionValue(manifest) as Readonly<Record<string, unknown>>
  const truncatedSections = Object.freeze(
    Object.entries(manifest)
      .filter(([, value]) => Array.isArray(value) && value.length > MAX_INSPECTION_RESULTS)
      .map(([section]) => section),
  )
  return Object.freeze({
    ...sanitized,
    _gnosis: Object.freeze({
      arrayLimit: MAX_INSPECTION_RESULTS,
      truncatedSections,
    }),
  })
}

export function createGnosisKnowledge(manifest: DoxaManifest): GnosisKnowledge {
  const info = applicationInfo(manifest)
  const graph = inspectGraph(manifest)
  const hasTheoria = manifest.providers.some((provider) =>
    provider.capabilities.includes('observations'),
  )
  return Object.freeze({
    schemaVersion: GNOSIS_KNOWLEDGE_SCHEMA_VERSION,
    framework: 'Doxa',
    applicationId: manifest.applicationId,
    buildHash: manifest.buildHash,
    application: info,
    graph,
    principles: Object.freeze([
      'Opinionated and magical where safety permits.',
      'Prefer the better developer experience between equally viable choices.',
      'Folder names have no runtime meaning.',
      'Framework roles are explicitly declared by Features and compiled before boot.',
      'Entry points fail closed unless public or owned by a declared policy ability.',
      'Constructors are side-effect free; lifecycle owns I/O and background behavior.',
    ]),
    conventions: Object.freeze({
      files: 'kebab-case',
      classes: 'PascalCase',
      featureRegistration: 'role arrays',
      concreteDependencies: 'constructor autowiring',
      applicationCommands: 'doxa <colon-delimited-name>',
      httpResponses: 'return payloads; Doxa owns the success and failure envelope',
      deployment: 'one precompiled immutable image with role-specific commands',
    }),
    roles: Object.freeze(
      Object.fromEntries(
        graphSections.map((role) => [role, sanitizeInspectionValue(manifest[role])]),
      ),
    ),
    theoria: Object.freeze({
      installed: hasTheoria,
      purpose: 'Read-only correlation and causation debugger for framework executions.',
      safety: Object.freeze([
        'recursive secret redaction',
        'bounded PostgreSQL retention',
        'loopback-only host',
        'recording failure isolation',
      ]),
    }),
    deployment: Object.freeze({
      strategy: 'one-immutable-image',
      build: Object.freeze({
        command: 'doxa build',
        phase: 'image-build',
        outputs: Object.freeze(['dist/', '.doxa/']),
        runtimeCompilation: false,
      }),
      roles: Object.freeze({
        web: Object.freeze({ command: 'doxa serve', scalesHorizontally: true }),
        background: Object.freeze({
          command: 'doxa work',
          scalesHorizontally: true,
          admitsSchedules: true,
        }),
        migration: Object.freeze({
          command: 'doxa migrate',
          releaseJob: true,
          automaticOnBoot: false,
        }),
      }),
      advancedIsolation: Object.freeze({
        workerCommand: 'doxa work --without-scheduler',
        schedulerCommand: 'doxa schedule',
        useWhen: 'schedule admission requires independent resources or fault isolation',
      }),
    }),
    praxis: Object.freeze({
      runtime: Object.freeze(['dev', 'serve', 'work', 'work --without-scheduler', 'schedule']),
      inspect: Object.freeze([
        'graph',
        'route:list',
        'model:list',
        'event:list',
        'listener:list',
        'observer:list',
        'job:list',
        'schedule:list',
        'policy:list',
        'command:list',
      ]),
    }),
  })
}

export function sanitizeInspectionValue(value: unknown, key?: string, depth = 0): unknown {
  if (depth > 12) return '[TRUNCATED]'
  if (isSensitiveKey(key) && !isSafeDoxaToken(key, value)) return '[REDACTED]'
  if (typeof value === 'string') return redactText(value).slice(0, 20_000)
  if (Array.isArray(value)) {
    return Object.freeze(
      value
        .slice(0, MAX_INSPECTION_RESULTS)
        .map((entry) => sanitizeInspectionValue(entry, undefined, depth + 1)),
    )
  }
  if (!isRecord(value)) return value
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_INSPECTION_OBJECT_PROPERTIES)
        .map(([name, entry]) => [name, sanitizeInspectionValue(entry, name, depth + 1)]),
    ),
  )
}

function isSensitiveKey(key: string | undefined): boolean {
  return (
    key !== undefined &&
    /(?:authorization|cookie|password|passwd|passphrase|secret|token|api[-_]?key|credential|session|csrf|signature|private[-_]?key)/i.test(
      key,
    )
  )
}

function isSafeDoxaToken(key: string | undefined, value: unknown): boolean {
  return key === 'token' && typeof value === 'string' && value.startsWith('doxa:')
}

function redactText(value: string): string {
  return redactUriCredentials(value)
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[REDACTED]')
    .replace(/\b(token|password|secret|api[-_]?key|authorization)=([^\s&]+)/gi, '$1=[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(
      /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----/g,
      '[REDACTED]',
    )
    .slice(0, 20_000)
}

function redactUriCredentials(value: string): string {
  let cursor = 0
  let searchFrom = 0
  let redacted = ''
  while (searchFrom < value.length) {
    const protocol = value.indexOf('://', searchFrom)
    if (protocol === -1) break
    let schemeStart = protocol - 1
    while (schemeStart >= 0 && isUriSchemeCharacter(value[schemeStart]!)) schemeStart -= 1
    schemeStart += 1
    if (schemeStart === protocol || !/[A-Za-z]/.test(value[schemeStart]!)) {
      searchFrom = protocol + 3
      continue
    }
    const authorityStart = protocol + 3
    let authorityEnd = authorityStart
    while (authorityEnd < value.length && !isUriAuthorityBoundary(value[authorityEnd]!)) {
      authorityEnd += 1
    }
    const at = value.lastIndexOf('@', authorityEnd - 1)
    const separator = value.indexOf(':', authorityStart)
    if (at < authorityStart || separator < authorityStart || separator >= at) {
      searchFrom = Math.max(authorityEnd, protocol + 3)
      continue
    }
    redacted += `${value.slice(cursor, separator + 1)}[REDACTED]`
    cursor = at
    searchFrom = authorityEnd
  }
  return `${redacted}${value.slice(cursor)}`
}

function isUriSchemeCharacter(character: string): boolean {
  return /[A-Za-z0-9+.-]/.test(character)
}

function isUriAuthorityBoundary(character: string): boolean {
  return character === '/' || character === '?' || character === '#' || /\s/u.test(character)
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? redactText(error.message) : 'The Doxa manifest is invalid.'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

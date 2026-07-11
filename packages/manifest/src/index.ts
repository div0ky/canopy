export const MANIFEST_FORMAT_VERSION = 11 as const

export type Scope = 'singleton' | 'execution' | 'transient'

export interface SourceProvenance {
  readonly file: string
  readonly line: number
  readonly column: number
}

export interface ApplicationManifestEntry {
  readonly id: string
  readonly name: string
  readonly source: SourceProvenance
}

export interface FeatureManifestEntry {
  readonly id: string
  readonly name: string
  readonly source: SourceProvenance
}

export type ConfigurationValueKind = 'string' | 'number' | 'boolean' | 'literal-union' | 'secret-string'

export type ConfigurationDefault = string | number | boolean

export interface ConfigurationPropertyManifest {
  readonly name: string
  readonly environmentKey: string
  readonly kind: ConfigurationValueKind
  readonly allowedValues?: readonly ConfigurationDefault[]
  readonly optional: boolean
  readonly sensitive: boolean
  readonly defaultValue?: ConfigurationDefault
  readonly source: SourceProvenance
}

export interface ConfigurationManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly source: SourceProvenance
  readonly properties: readonly ConfigurationPropertyManifest[]
}

export interface DependencyManifestEntry {
  readonly kind: 'constructor' | 'role'
  readonly parameter: string
  readonly token: string
  readonly targetId?: string
  readonly optional: boolean
  readonly source: SourceProvenance
}

export interface LifecycleManifestEntry {
  readonly start: boolean
  readonly drain: boolean
  readonly stop: boolean
  readonly dispose: boolean
}

export interface ProviderManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly role: 'provider' | 'service'
  readonly scope: Scope
  readonly durableIdentity: boolean
  readonly capabilities: readonly ('authentication' | 'queues' | 'transactions' | 'cache' | 'mail' | 'sms' | 'telemetry' | 'observations')[]
  readonly source: SourceProvenance
  readonly dependencies: readonly DependencyManifestEntry[]
  readonly lifecycle: LifecycleManifestEntry
}

export interface OperationManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly role: 'action' | 'query'
  readonly scope: 'transient'
  readonly transactional: boolean
  readonly access: 'public' | string
  readonly source: SourceProvenance
  readonly dependencies: readonly DependencyManifestEntry[]
  readonly lifecycle: LifecycleManifestEntry
}

export interface ModelManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly entityType: string
  readonly storage:
    | { readonly kind: 'entity-state' }
    | {
        readonly kind: 'table'
        readonly table: string
        readonly primaryKey: string
        readonly columns: Readonly<Record<string, string>>
        readonly versionColumn?: string
        readonly timestamps: false | { readonly createdAt: string; readonly updatedAt: string }
      }
  readonly source: SourceProvenance
}

export type ModelObserverPhase =
  | 'retrieved' | 'saving' | 'creating' | 'updating'
  | 'created' | 'updated' | 'saved' | 'committed'

export interface ObserverManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly modelId: string
  readonly phases: readonly ModelObserverPhase[]
  readonly scope: 'transient'
  readonly source: SourceProvenance
  readonly dependencies: readonly DependencyManifestEntry[]
  readonly lifecycle: LifecycleManifestEntry
}

export interface RouteManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly method: 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT'
  readonly path: string
  readonly access: 'public' | string
  readonly scope: 'transient'
  readonly source: SourceProvenance
  readonly dependencies: readonly DependencyManifestEntry[]
  readonly lifecycle: LifecycleManifestEntry
}

export interface EventManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly dispatch: 'immediate' | 'after-commit'
  readonly source: SourceProvenance
}

export interface ListenerManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly eventId: string
  readonly delivery: 'local' | 'after-commit' | 'queued' | 'queued-after-commit'
  readonly access: 'public' | string
  readonly scope: 'transient'
  readonly source: SourceProvenance
  readonly dependencies: readonly DependencyManifestEntry[]
  readonly lifecycle: LifecycleManifestEntry
}

export interface JobManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly scope: 'transient'
  readonly retries: number
  readonly retryDelay: number
  readonly backoff: boolean
  readonly timeout: number
  readonly access: 'public' | string
  readonly source: SourceProvenance
  readonly dependencies: readonly DependencyManifestEntry[]
  readonly lifecycle: LifecycleManifestEntry
}

export interface ScheduleManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly jobId: string
  readonly cadence:
    | { readonly kind: 'cron'; readonly expression: string }
    | { readonly kind: 'interval'; readonly seconds: number }
  readonly timeZone: string
  readonly overlap: 'allow' | 'serialize'
  readonly misfire: 'skip'
  readonly input: unknown
  readonly access: 'public' | string
  readonly source: SourceProvenance
}

export interface PolicyManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly scope: 'transient'
  readonly abilities: readonly string[]
  readonly source: SourceProvenance
  readonly dependencies: readonly DependencyManifestEntry[]
  readonly lifecycle: LifecycleManifestEntry
}

export interface SignalManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly source: SourceProvenance
}

export interface SignalHandlerManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly signalId: string
  readonly access: 'public' | string
  readonly scope: 'transient'
  readonly source: SourceProvenance
  readonly dependencies: readonly DependencyManifestEntry[]
  readonly lifecycle: LifecycleManifestEntry
}

export interface CommandManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly command: string
  readonly description: string
  readonly access: 'public' | string
  readonly scope: 'transient'
  readonly source: SourceProvenance
  readonly dependencies: readonly DependencyManifestEntry[]
  readonly lifecycle: LifecycleManifestEntry
}

export interface CanopyManifest {
  readonly formatVersion: typeof MANIFEST_FORMAT_VERSION
  readonly applicationId: string
  readonly frameworkVersion: string
  readonly compilerVersion: string
  readonly buildHash: string
  readonly application: ApplicationManifestEntry
  readonly features: readonly FeatureManifestEntry[]
  readonly configurations: readonly ConfigurationManifestEntry[]
  readonly providers: readonly ProviderManifestEntry[]
  readonly actions: readonly OperationManifestEntry[]
  readonly queries: readonly OperationManifestEntry[]
  readonly models: readonly ModelManifestEntry[]
  readonly observers: readonly ObserverManifestEntry[]
  readonly routes: readonly RouteManifestEntry[]
  readonly events: readonly EventManifestEntry[]
  readonly listeners: readonly ListenerManifestEntry[]
  readonly jobs: readonly JobManifestEntry[]
  readonly schedules: readonly ScheduleManifestEntry[]
  readonly policies: readonly PolicyManifestEntry[]
  readonly signals: readonly SignalManifestEntry[]
  readonly signalHandlers: readonly SignalHandlerManifestEntry[]
  readonly commands: readonly CommandManifestEntry[]
}

export interface RegistryModule {
  readonly formatVersion: number
  readonly buildHash: string
  readonly constructors: Readonly<Record<string, new (...dependencies: unknown[]) => object>>
}

export class ManifestCompatibilityError extends Error {
  override readonly name = 'ManifestCompatibilityError'
}

/** One canonical representation shared by artifact producers and consumers. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortCanonicalValue(value), null, 2)
}

export function assertManifest(value: unknown): asserts value is CanopyManifest {
  if (!isRecord(value)) {
    throw new ManifestCompatibilityError('Canopy manifest must be a JSON object.')
  }

  if (value.formatVersion !== MANIFEST_FORMAT_VERSION) {
    throw new ManifestCompatibilityError(
      `Unsupported Canopy manifest format ${String(value.formatVersion)}; expected ${MANIFEST_FORMAT_VERSION}.`,
    )
  }

  for (const field of ['applicationId', 'frameworkVersion', 'compilerVersion', 'buildHash'] as const) {
    if (typeof value[field] !== 'string' || value[field].length === 0) {
      throw new ManifestCompatibilityError(`Canopy manifest field ${field} must be a non-empty string.`)
    }
  }

  if (!isRecord(value.application) || !Array.isArray(value.features)
    || !Array.isArray(value.configurations) || !Array.isArray(value.providers)
    || !Array.isArray(value.actions) || !Array.isArray(value.queries)
    || !Array.isArray(value.models) || !Array.isArray(value.observers) || !Array.isArray(value.routes)
    || !Array.isArray(value.events) || !Array.isArray(value.listeners)
    || !Array.isArray(value.jobs) || !Array.isArray(value.schedules)
    || !Array.isArray(value.policies) || !Array.isArray(value.signals)
    || !Array.isArray(value.signalHandlers) || !Array.isArray(value.commands)) {
    throw new ManifestCompatibilityError('Canopy manifest is missing required graph sections.')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sortCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonicalValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortCanonicalValue(nested)]),
  )
}

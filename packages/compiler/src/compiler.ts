import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'

import {
  MANIFEST_FORMAT_VERSION,
  canonicalJson,
  type CanopyManifest,
  type CommandManifestEntry,
  type ConfigurationDefault,
  type ConfigurationManifestEntry,
  type ConfigurationPropertyManifest,
  type DependencyManifestEntry,
  type EventManifestEntry,
  type FeatureManifestEntry,
  type ListenerManifestEntry,
  type JobManifestEntry,
  type ModelManifestEntry,
  type OperationManifestEntry,
  type ObserverManifestEntry,
  type ProviderManifestEntry,
  type PolicyManifestEntry,
  type RouteManifestEntry,
  type ScheduleManifestEntry,
  type SignalManifestEntry,
  type SignalHandlerManifestEntry,
  type SourceProvenance,
} from '@canopy/manifest'

const FRAMEWORK_VERSION = '0.1.0'
const COMPILER_VERSION = '0.1.0'
const DECLARATION_FIELDS = new Set([
  'id',
  'features',
  'configs',
  'providers',
  'actions',
  'queries',
  'models',
  'observers',
  'routes',
  'events',
  'listeners',
  'jobs',
  'schedules',
  'policies',
  'signals',
  'signalHandlers',
  'commands',
])

export interface CompileApplicationOptions {
  readonly tsconfigPath: string
  readonly applicationFile: string
  readonly sourceRoot: string
  readonly outputRoot: string
  readonly artifactsDirectory: string
  readonly applicationExport?: string
}

export interface CompileApplicationResult {
  readonly manifest: CanopyManifest
  readonly manifestPath: string
  readonly registryPath: string
}

export class CanopyCompilationError extends Error {
  override readonly name = 'CanopyCompilationError'
}

interface RegisteredClass {
  readonly id: string
  readonly declaration: ts.ClassDeclaration
}

export async function compileApplication(
  options: CompileApplicationOptions,
): Promise<CompileApplicationResult> {
  const normalized = normalizeOptions(options)
  const program = createProgram(normalized.tsconfigPath)
  const checker = program.getTypeChecker()
  assertValidProgram(program)

  const applicationSource = program.getSourceFile(normalized.applicationFile)
  if (!applicationSource) {
    throw new CanopyCompilationError(
      `Application source is not part of the TypeScript program: ${normalized.applicationFile}`,
    )
  }

  const applicationDeclaration = findExportedClass(
    applicationSource,
    normalized.applicationExport,
  )
  assertDeclarationOnly(applicationDeclaration, 'Application')
  const applicationId = readRequiredInstanceString(applicationDeclaration, 'id')
  const applicationName = requiredClassName(applicationDeclaration)

  const featureDeclarations = readClassArray(applicationDeclaration, 'features', checker)
  const features = featureDeclarations.map((declaration) => {
    assertDeclarationOnly(declaration, 'Feature')
    return {
      id: readRequiredInstanceString(declaration, 'id'),
      name: requiredClassName(declaration),
      source: sourceOf(declaration, normalized.projectRoot),
    } satisfies FeatureManifestEntry
  })
  assertUnique(features, (feature) => feature.id, 'Feature ID')

  const configurations: ConfigurationManifestEntry[] = []
  const configurationByDeclaration = new Map<ts.ClassDeclaration, ConfigurationManifestEntry>()

  registerConfigurations(
    readClassArray(applicationDeclaration, 'configs', checker),
    `application:${applicationId}`,
  )

  for (let index = 0; index < featureDeclarations.length; index += 1) {
    const declaration = featureDeclarations[index]
    const feature = features[index]
    if (!declaration || !feature) continue
    registerConfigurations(readClassArray(declaration, 'configs', checker), feature.id)
  }

  const providers: ProviderManifestEntry[] = []
  const providerByDeclaration = new Map<ts.ClassDeclaration, ProviderManifestEntry>()
  const providerRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const actions: OperationManifestEntry[] = []
  const queries: OperationManifestEntry[] = []
  const operationByDeclaration = new Map<ts.ClassDeclaration, OperationManifestEntry>()
  const operationRoots = new Map<
    ts.ClassDeclaration,
    { readonly ownerId: string; readonly role: 'action' | 'query' }
  >()
  const models: ModelManifestEntry[] = []
  const modelByDeclaration = new Map<ts.ClassDeclaration, ModelManifestEntry>()
  const modelRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const observers: ObserverManifestEntry[] = []
  const observerByDeclaration = new Map<ts.ClassDeclaration, ObserverManifestEntry>()
  const observerRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const routes: RouteManifestEntry[] = []
  const routeByDeclaration = new Map<ts.ClassDeclaration, RouteManifestEntry>()
  const routeRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const events: EventManifestEntry[] = []
  const eventByDeclaration = new Map<ts.ClassDeclaration, EventManifestEntry>()
  const eventRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const listeners: ListenerManifestEntry[] = []
  const listenerByDeclaration = new Map<ts.ClassDeclaration, ListenerManifestEntry>()
  const listenerRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const jobs: JobManifestEntry[] = []
  const jobByDeclaration = new Map<ts.ClassDeclaration, JobManifestEntry>()
  const jobRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const schedules: ScheduleManifestEntry[] = []
  const scheduleByDeclaration = new Map<ts.ClassDeclaration, ScheduleManifestEntry>()
  const scheduleRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const policies: PolicyManifestEntry[] = []
  const policyByDeclaration = new Map<ts.ClassDeclaration, PolicyManifestEntry>()
  const policyRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const signals: SignalManifestEntry[] = []
  const signalByDeclaration = new Map<ts.ClassDeclaration, SignalManifestEntry>()
  const signalRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const signalHandlers: SignalHandlerManifestEntry[] = []
  const signalHandlerByDeclaration = new Map<ts.ClassDeclaration, SignalHandlerManifestEntry>()
  const signalHandlerRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const commands: CommandManifestEntry[] = []
  const commandByDeclaration = new Map<ts.ClassDeclaration, CommandManifestEntry>()
  const commandRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()

  for (let index = 0; index < featureDeclarations.length; index += 1) {
    const featureDeclaration = featureDeclarations[index]
    const feature = features[index]
    if (!featureDeclaration || !feature) continue

    for (const providerDeclaration of readClassArray(featureDeclaration, 'providers', checker)) {
      const existing = providerRoots.get(providerDeclaration)
      if (existing && existing.ownerId !== feature.id) {
        fail(providerDeclaration, `${requiredClassName(providerDeclaration)} is declared as a provider by multiple Features.`)
      }
      providerRoots.set(providerDeclaration, { ownerId: feature.id })
    }
  }

  for (let index = 0; index < featureDeclarations.length; index += 1) {
    const featureDeclaration = featureDeclarations[index]
    const feature = features[index]
    if (!featureDeclaration || !feature) continue
    for (const action of readClassArray(featureDeclaration, 'actions', checker)) {
      registerOperationRoot(action, feature.id, 'action')
    }
    for (const query of readClassArray(featureDeclaration, 'queries', checker)) {
      registerOperationRoot(query, feature.id, 'query')
    }
    for (const model of readClassArray(featureDeclaration, 'models', checker)) {
      const existing = modelRoots.get(model)
      if (existing) {
        fail(model, `${requiredClassName(model)} is already declared as a model by ${existing.ownerId}.`)
      }
      modelRoots.set(model, { ownerId: feature.id })
    }
    registerOwnedRoots(featureDeclaration, 'observers', feature.id, observerRoots, 'observer')
    registerOwnedRoots(featureDeclaration, 'routes', feature.id, routeRoots, 'route')
    registerOwnedRoots(featureDeclaration, 'events', feature.id, eventRoots, 'event')
    registerOwnedRoots(featureDeclaration, 'listeners', feature.id, listenerRoots, 'listener')
    registerOwnedRoots(featureDeclaration, 'jobs', feature.id, jobRoots, 'job')
    registerOwnedRoots(featureDeclaration, 'schedules', feature.id, scheduleRoots, 'schedule')
    registerOwnedRoots(featureDeclaration, 'policies', feature.id, policyRoots, 'policy')
    registerOwnedRoots(featureDeclaration, 'signals', feature.id, signalRoots, 'signal')
    registerOwnedRoots(featureDeclaration, 'signalHandlers', feature.id, signalHandlerRoots, 'signal handler')
    registerOwnedRoots(featureDeclaration, 'commands', feature.id, commandRoots, 'command')
  }

  for (const [providerDeclaration, root] of providerRoots) {
    registerProvider(providerDeclaration, root.ownerId, 'provider')
  }

  for (const [operation, root] of operationRoots) {
    registerOperation(operation, root.ownerId, root.role)
  }
  for (const [model, root] of modelRoots) {
    registerModel(model, root.ownerId)
  }
  for (const [observer, root] of observerRoots) registerObserver(observer, root.ownerId)
  for (const [event, root] of eventRoots) {
    registerEvent(event, root.ownerId)
  }
  for (const [listener, root] of listenerRoots) {
    registerListener(listener, root.ownerId)
  }
  for (const [route, root] of routeRoots) {
    registerRoute(route, root.ownerId)
  }
  for (const [job, root] of jobRoots) {
    registerJob(job, root.ownerId)
  }
  for (const [schedule, root] of scheduleRoots) {
    registerSchedule(schedule, root.ownerId)
  }
  for (const [policy, root] of policyRoots) {
    registerPolicy(policy, root.ownerId)
  }
  for (const [signal, root] of signalRoots) registerSignal(signal, root.ownerId)
  for (const [handler, root] of signalHandlerRoots) registerSignalHandler(handler, root.ownerId)
  for (const [command, root] of commandRoots) registerCommand(command, root.ownerId)

  assertUnique(providers, (provider) => provider.id, 'provider ID')
  assertUnique(actions, (operation) => operation.id, 'action ID')
  assertUnique(queries, (operation) => operation.id, 'query ID')
  assertUnique(models, (model) => model.id, 'model ID')
  assertUnique(observers, (observer) => observer.id, 'observer ID')
  assertUnique(routes, (route) => route.id, 'route ID')
  assertUnique(routes, (route) => `${route.method} ${route.path}`, 'HTTP route')
  assertUnique(events, (event) => event.id, 'event ID')
  assertUnique(listeners, (listener) => listener.id, 'listener ID')
  assertUnique(jobs, (job) => job.id, 'job ID')
  assertUnique(schedules, (schedule) => schedule.id, 'schedule ID')
  assertUnique(policies, (policy) => policy.id, 'policy ID')
  assertUnique(signals, (signal) => signal.id, 'signal ID')
  assertUnique(signalHandlers, (handler) => handler.id, 'signal handler ID')
  assertUnique(commands, (command) => command.id, 'command ID')
  assertUnique(commands, (command) => command.command, 'command name')
  assertUnique(
    policies.flatMap((policy) => policy.abilities.map((ability) => ({ ability, policy }))),
    (entry) => entry.ability,
    'policy ability',
  )
  const policyAbilities = new Set(policies.flatMap((policy) => policy.abilities))
  for (const entry of [...routes, ...actions, ...queries, ...listeners, ...jobs, ...schedules, ...signalHandlers, ...commands]) {
    if (entry.access !== 'public' && !policyAbilities.has(entry.access)) {
      throw new CanopyCompilationError(
        `${entry.id} requires ability ${entry.access}, but no selected Policy declares it.`,
      )
    }
  }
  assertAcyclicProviderGraph(providers)
  assertScopeSafety(providers)
  const transactionProviders = providers.filter(
    (provider) => provider.capabilities.includes('transactions'),
  )
  if (actions.length > 0 && transactionProviders.length !== 1) {
    throw new CanopyCompilationError(
      `Applications with actions require exactly one transaction provider; found ${transactionProviders.length}.`,
    )
  }
  const queueProviders = providers.filter((provider) => provider.capabilities.includes('queues'))
  const authenticationProviders = providers.filter(
    (provider) => provider.capabilities.includes('authentication'),
  )
  if (authenticationProviders.length > 1) {
    throw new CanopyCompilationError(
      `Applications may declare at most one authentication provider; found ${authenticationProviders.length}.`,
    )
  }
  const cacheProviders = providers.filter((provider) => provider.capabilities.includes('cache'))
  if (cacheProviders.length > 1) {
    throw new CanopyCompilationError(
      `Applications may declare at most one cache provider; found ${cacheProviders.length}.`,
    )
  }
  for (const capability of ['mail', 'sms', 'telemetry'] as const) {
    const selected = providers.filter((provider) => provider.capabilities.includes(capability))
    if (selected.length > 1) throw new CanopyCompilationError(`Applications may declare at most one ${capability} provider; found ${selected.length}.`)
  }
  const queuedListeners = listeners.filter(
    (listener) => listener.delivery === 'queued' || listener.delivery === 'queued-after-commit',
  )
  const communicationProviders = providers.filter((provider) => provider.capabilities.includes('mail') || provider.capabilities.includes('sms'))
  if ((jobs.length > 0 || queuedListeners.length > 0 || schedules.length > 0 || communicationProviders.length > 0) && queueProviders.length !== 1) {
    throw new CanopyCompilationError(
      `Applications with jobs, schedules, or queued listeners require exactly one queue provider; found ${queueProviders.length}.`,
    )
  }

  const application = {
    id: applicationId,
    name: applicationName,
    source: sourceOf(applicationDeclaration, normalized.projectRoot),
  }

  const semanticManifest = {
    formatVersion: MANIFEST_FORMAT_VERSION,
    applicationId,
    frameworkVersion: FRAMEWORK_VERSION,
    compilerVersion: COMPILER_VERSION,
    application,
    features: [...features].sort(byId),
    configurations: [...configurations].sort(byId),
    providers: [...providers].sort(byId),
    actions: [...actions].sort(byId),
    queries: [...queries].sort(byId),
    models: [...models].sort(byId),
    observers: [...observers].sort(byId),
    routes: [...routes].sort(byId),
    events: [...events].sort(byId),
    listeners: [...listeners].sort(byId),
    jobs: [...jobs].sort(byId),
    schedules: [...schedules].sort(byId),
    policies: [...policies].sort(byId),
    signals: [...signals].sort(byId),
    signalHandlers: [...signalHandlers].sort(byId),
    commands: [...commands].sort(byId),
  }
  const buildHash = createHash('sha256').update(canonicalJson(semanticManifest)).digest('hex')
  const manifest: CanopyManifest = { ...semanticManifest, buildHash }

  await mkdir(normalized.artifactsDirectory, { recursive: true })
  const manifestPath = path.join(normalized.artifactsDirectory, 'manifest.json')
  const registryPath = path.join(normalized.artifactsDirectory, 'registry.mjs')
  await writeFile(manifestPath, `${canonicalJson(manifest)}\n`, 'utf8')
  await writeFile(
    registryPath,
    renderRegistry(
      {
        id: `application:${applicationId}`,
        declaration: applicationDeclaration,
      },
      [...configurationByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...providerByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...operationByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...modelByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...observerByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...routeByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...eventByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...listenerByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...jobByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...scheduleByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...policyByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...signalByDeclaration.entries()].map(([declaration, entry]) => ({ id: entry.id, declaration })),
      [...signalHandlerByDeclaration.entries()].map(([declaration, entry]) => ({ id: entry.id, declaration })),
      [...commandByDeclaration.entries()].map(([declaration, entry]) => ({ id: entry.id, declaration })),
      buildHash,
      normalized,
    ),
    'utf8',
  )

  return { manifest, manifestPath, registryPath }

  function registerConfigurations(
    declarations: readonly ts.ClassDeclaration[],
    ownerId: string,
  ): void {
    for (const declaration of declarations) {
      const existing = configurationByDeclaration.get(declaration)
      if (existing) {
        if (existing.ownerId !== ownerId) {
          fail(declaration, `Configuration ${existing.name} is declared by multiple owners.`)
        }
        continue
      }

      assertConfigurationDeclaration(declaration)
      const name = requiredClassName(declaration)
      const localId = toKebabCase(name.replace(/Config$/, ''))
      const id = `config:${ownerId}/${localId}`
      const properties = declaration.members
        .filter(ts.isPropertyDeclaration)
        .filter((property) => !hasModifier(property, ts.SyntaxKind.StaticKeyword))
        .map((property) => compileConfigurationProperty(name, property, checker, normalized.projectRoot))

      const entry: ConfigurationManifestEntry = {
        id,
        ownerId,
        name,
        exportName: name,
        source: sourceOf(declaration, normalized.projectRoot),
        properties,
      }
      configurations.push(entry)
      configurationByDeclaration.set(declaration, entry)
    }
  }

  function registerProvider(
    declaration: ts.ClassDeclaration,
    ownerId: string,
    role: 'provider' | 'service',
  ): ProviderManifestEntry {
    assertConcreteClass(declaration)
    const existing = providerByDeclaration.get(declaration)
    if (existing) {
      if (existing.ownerId !== ownerId) {
        fail(declaration, `Concrete service ${existing.name} is reachable across Feature boundaries without being provided explicitly.`)
      }
      return existing
    }

    const name = requiredClassName(declaration)
    const localId = role === 'provider'
      ? readRequiredStaticString(declaration, 'id')
      : toKebabCase(name)
    const id = `${role}:${ownerId}/${localId}`
    const placeholder: ProviderManifestEntry = {
      id,
      ownerId,
      name,
      exportName: name,
      role,
      scope: role === 'provider'
        ? 'singleton'
        : implementsNamedInterface(declaration, 'ExecutionScoped', checker)
          ? 'execution'
          : 'transient',
      durableIdentity: role === 'provider',
      capabilities: [
        ...(extendsNamedClass(declaration, 'Auth', checker)
          ? ['authentication' as const]
          : []),
        ...(extendsNamedClass(declaration, 'TransactionManager', checker)
          ? ['transactions' as const]
          : []),
        ...(extendsNamedClass(declaration, 'QueueManager', checker)
          ? ['queues' as const]
          : []),
        ...(extendsNamedClass(declaration, 'Cache', checker)
          ? ['cache' as const]
          : []),
        ...(extendsNamedClass(declaration, 'MailTransport', checker)
          ? ['mail' as const]
          : []),
        ...(extendsNamedClass(declaration, 'SmsTransport', checker)
          ? ['sms' as const]
          : []),
        ...(extendsNamedClass(declaration, 'Telemetry', checker)
          ? ['telemetry' as const]
          : []),
        ...(extendsNamedClass(declaration, 'ObservationRecorder', checker)
          ? ['observations' as const]
          : []),
      ],
      source: sourceOf(declaration, normalized.projectRoot),
      dependencies: [],
      lifecycle: lifecycleOf(declaration, checker),
    }
    providerByDeclaration.set(declaration, placeholder)
    providers.push(placeholder)

    const complete = { ...placeholder, dependencies: dependenciesFor(declaration, ownerId) }
    providerByDeclaration.set(declaration, complete)
    providers[providers.indexOf(placeholder)] = complete
    return complete
  }

  function dependenciesFor(
    declaration: ts.ClassDeclaration,
    ownerId: string,
  ): readonly DependencyManifestEntry[] {
    const constructor = declaration.members.find(ts.isConstructorDeclaration)
    const frameworkRole = [
      'Action', 'Query', 'Route', 'Listener', 'Job', 'Policy', 'SignalHandler', 'Observer', 'Command',
    ].some((role) => extendsNamedClass(declaration, role, checker))
    if (frameworkRole && constructor && constructor.parameters.length > 0) {
      fail(
        constructor,
        `${requiredClassName(declaration)} is a framework role; declare scoped dependencies with this.inject() instead of constructor parameters.`,
      )
    }
    const constructorDependencies = constructor?.parameters.map((parameter) => dependencyFor(
      parameter,
      parameter.name.getText(),
      Boolean(parameter.questionToken || parameter.initializer)
        || includesUndefined(checker.getTypeAtLocation(parameter)),
      'constructor',
      classDeclarationForType(parameter, checker),
    )) ?? []
    const injectionCalls: ts.CallExpression[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && roleInjectionKind(node)) {
        injectionCalls.push(node)
      }
      ts.forEachChild(node, visit)
    }
    declaration.members.forEach(visit)
    const roleDependencies = injectionCalls.map((call) => {
      const member = call.parent
      if (!ts.isPropertyDeclaration(member) || member.initializer !== call || member.parent !== declaration) {
        fail(call, 'this.inject() must be the direct initializer of a role class property.')
      }
      const injectionKind = roleInjectionKind(call)
      if (!injectionKind || call.arguments.length !== 1) {
        fail(call, 'this.inject() requires exactly one statically identifiable dependency token.')
      }
      const name = propertyName(member.name)
      if (!name) fail(member, 'Injected role properties must use an identifier or string literal name.')
      const dependencyDeclaration = resolveClassReference(call.arguments[0]!, checker)
      return dependencyFor(call, name, injectionKind === 'optional', 'role', dependencyDeclaration)
    })
    return [...constructorDependencies, ...roleDependencies]

    function dependencyFor(
      source: ts.Node,
      parameter: string,
      optional: boolean,
      kind: DependencyManifestEntry['kind'],
      dependencyDeclaration: ts.ClassDeclaration | undefined,
    ): DependencyManifestEntry {
      let targetId: string | undefined

      if (dependencyDeclaration) {
        const builtinId = builtinIdForDeclaration(dependencyDeclaration)
        const capability = providerCapabilityForDeclaration(dependencyDeclaration)
        const capabilityProvider = capability
          ? providers.find((provider) => provider.capabilities.includes(capability))
          : undefined
        if (capability && !capabilityProvider && !optional) {
          fail(
            source,
            `${requiredClassName(dependencyDeclaration)} requires one selected ${capability} provider.`,
          )
        }
        const configuration = configurationByDeclaration.get(dependencyDeclaration)
        const providerRoot = providerRoots.get(dependencyDeclaration)
        const operationRoot = operationRoots.get(dependencyDeclaration)
        const modelRoot = modelRoots.get(dependencyDeclaration)
        const observerRoot = observerRoots.get(dependencyDeclaration)
        const routeRoot = routeRoots.get(dependencyDeclaration)
        const eventRoot = eventRoots.get(dependencyDeclaration)
        const listenerRoot = listenerRoots.get(dependencyDeclaration)
        const jobRoot = jobRoots.get(dependencyDeclaration)
        const scheduleRoot = scheduleRoots.get(dependencyDeclaration)
        const policyRoot = policyRoots.get(dependencyDeclaration)
        const signalRoot = signalRoots.get(dependencyDeclaration)
        const signalHandlerRoot = signalHandlerRoots.get(dependencyDeclaration)
        const commandRoot = commandRoots.get(dependencyDeclaration)
        if (operationRoot) {
          fail(
            source,
            `${requiredClassName(dependencyDeclaration)} is an operation class; inject ActionBus or QueryBus instead.`,
          )
        }
        if (modelRoot) {
          fail(source, `${requiredClassName(dependencyDeclaration)} is a model class and is not a dependency; use its static retrieval API.`)
        }
        if (routeRoot || eventRoot || listenerRoot || jobRoot || scheduleRoot || policyRoot || observerRoot
          || signalRoot || signalHandlerRoot || commandRoot) {
          fail(
            source,
            `${requiredClassName(dependencyDeclaration)} is a framework role class and cannot be injected directly.`,
          )
        }
        if (providerRoot && providerRoot.ownerId !== ownerId) {
          fail(source, `${requiredClassName(dependencyDeclaration)} is private to Feature ${providerRoot.ownerId}.`)
        }
        const abstractDependency = hasModifier(dependencyDeclaration, ts.SyntaxKind.AbstractKeyword)
        targetId = builtinId ?? capabilityProvider?.id ?? configuration?.id
          ?? (optional && abstractDependency
            ? undefined
            : registerProvider(
              dependencyDeclaration,
              providerRoot?.ownerId ?? ownerId,
              providerRoot ? 'provider' : 'service',
            ).id)
      }

      if (!targetId && !optional) {
        fail(source, `Required ${kind === 'role' ? 'role' : 'constructor'} dependency ${parameter} cannot be resolved to a declared configuration or concrete class.`)
      }

      return {
        kind,
        parameter,
        token: dependencyDeclaration ? requiredClassName(dependencyDeclaration) : parameter,
        ...(targetId ? { targetId } : {}),
        optional,
        source: sourceOf(source, normalized.projectRoot),
      } satisfies DependencyManifestEntry
    }
  }

  function registerOperation(
    declaration: ts.ClassDeclaration,
    ownerId: string,
    role: 'action' | 'query',
  ): OperationManifestEntry {
    assertConcreteClass(declaration)
    const existing = operationByDeclaration.get(declaration)
    if (existing) {
      fail(declaration, `${existing.name} is declared more than once as an application operation.`)
    }
    if (!extendsNamedClass(declaration, role === 'action' ? 'Action' : 'Query', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend ${role === 'action' ? 'Action' : 'Query'}.`)
    }
    if (!checker.getTypeAtLocation(declaration).getProperty('handle')) {
      fail(declaration, `${requiredClassName(declaration)} must define handle(input).`)
    }

    const name = requiredClassName(declaration)
    const lifecycle = lifecycleOf(declaration, checker)
    if (lifecycle.start || lifecycle.drain || lifecycle.stop) {
      fail(declaration, `${name} may define dispose(), but operation handlers cannot own application lifecycle phases.`)
    }
    const entry: OperationManifestEntry = {
      id: `${role}:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name,
      exportName: name,
      role,
      scope: 'transient',
      transactional: role === 'action',
      access: readAccess(declaration),
      source: sourceOf(declaration, normalized.projectRoot),
      dependencies: [],
      lifecycle,
    }
    operationByDeclaration.set(declaration, entry)
    const complete = { ...entry, dependencies: dependenciesFor(declaration, ownerId) }
    operationByDeclaration.set(declaration, complete)
    const operations = role === 'action' ? actions : queries
    operations.push(complete)
    return complete
  }

  function registerOperationRoot(
    declaration: ts.ClassDeclaration,
    ownerId: string,
    role: 'action' | 'query',
  ): void {
    const existing = operationRoots.get(declaration)
    if (existing) {
      fail(
        declaration,
        `${requiredClassName(declaration)} is already declared as ${existing.role} by ${existing.ownerId}.`,
      )
    }
    operationRoots.set(declaration, { ownerId, role })
  }

  function registerOwnedRoots(
    feature: ts.ClassDeclaration,
    field: 'routes' | 'events' | 'listeners' | 'jobs' | 'schedules' | 'policies' | 'signals' | 'signalHandlers' | 'observers' | 'commands',
    ownerId: string,
    roots: Map<ts.ClassDeclaration, { readonly ownerId: string }>,
    role: string,
  ): void {
    for (const declaration of readClassArray(feature, field, checker)) {
      const existing = roots.get(declaration)
      if (existing) {
        fail(
          declaration,
          `${requiredClassName(declaration)} is already declared as a ${role} by ${existing.ownerId}.`,
        )
      }
      roots.set(declaration, { ownerId })
    }
  }

  function registerModel(
    declaration: ts.ClassDeclaration,
    ownerId: string,
  ): ModelManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'Model', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend Model.`)
    }
    const name = requiredClassName(declaration)
    const localId = readRequiredStaticString(declaration, 'id')
    const entry: ModelManifestEntry = {
      id: `model:${ownerId}/${localId}`,
      ownerId,
      name,
      exportName: name,
      entityType: `model:${ownerId}/${localId}`,
      storage: compileModelStorage(declaration),
      source: sourceOf(declaration, normalized.projectRoot),
    }
    modelByDeclaration.set(declaration, entry)
    models.push(entry)
    return entry
  }

  function compileModelStorage(declaration: ts.ClassDeclaration): ModelManifestEntry['storage'] {
    const tableValue = readOptionalStaticJson(declaration, 'table')
    if (tableValue === undefined) return { kind: 'entity-state' }
    if (typeof tableValue !== 'string' || !validQualifiedIdentifier(tableValue)) {
      fail(declaration, `${requiredClassName(declaration)}.table must be a literal PostgreSQL table name.`)
    }
    const columnsValue = readOptionalStaticJson(declaration, 'columns') ?? {}
    if (!isStringRecord(columnsValue)) {
      fail(declaration, `${requiredClassName(declaration)}.columns must be a literal attribute-to-column string object.`)
    }
    for (const [attribute, column] of Object.entries(columnsValue)) {
      if (!validIdentifier(attribute) || !validIdentifier(column)) {
        fail(declaration, `${requiredClassName(declaration)}.columns contains an invalid attribute or PostgreSQL column name.`)
      }
    }
    const primaryKeyValue = readOptionalStaticJson(declaration, 'primaryKey') ?? columnsValue.id ?? 'id'
    if (typeof primaryKeyValue !== 'string' || !validIdentifier(primaryKeyValue)) {
      fail(declaration, `${requiredClassName(declaration)}.primaryKey must be a literal PostgreSQL column name.`)
    }
    const versionValue = readOptionalStaticJson(declaration, 'versionColumn')
    if (versionValue !== undefined && (typeof versionValue !== 'string' || !validIdentifier(versionValue))) {
      fail(declaration, `${requiredClassName(declaration)}.versionColumn must be a literal PostgreSQL column name.`)
    }
    const timestampsValue = readOptionalStaticJson(declaration, 'timestamps') ?? false
    let timestamps: false | { readonly createdAt: string; readonly updatedAt: string }
    if (timestampsValue === false) timestamps = false
    else if (timestampsValue === true) timestamps = { createdAt: 'created_at', updatedAt: 'updated_at' }
    else if (isStringRecord(timestampsValue)
      && typeof timestampsValue.createdAt === 'string' && validIdentifier(timestampsValue.createdAt)
      && typeof timestampsValue.updatedAt === 'string' && validIdentifier(timestampsValue.updatedAt)) {
      timestamps = { createdAt: timestampsValue.createdAt, updatedAt: timestampsValue.updatedAt }
    } else {
      fail(declaration, `${requiredClassName(declaration)}.timestamps must be false, true, or { createdAt, updatedAt } column names.`)
    }
    return {
      kind: 'table',
      table: tableValue,
      primaryKey: primaryKeyValue,
      columns: { ...columnsValue, id: primaryKeyValue },
      ...(typeof versionValue === 'string' ? { versionColumn: versionValue } : {}),
      timestamps,
    }
  }

  function registerObserver(
    declaration: ts.ClassDeclaration,
    ownerId: string,
  ): ObserverManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'Observer', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend Observer.`)
    }
    const phaseNames = [
      'retrieved', 'saving', 'creating', 'updating',
      'created', 'updated', 'saved', 'committed',
    ] as const
    const methods = declaration.members.filter(
      (member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member)
        && phaseNames.includes(propertyName(member.name) as typeof phaseNames[number]),
    )
    if (methods.length === 0) {
      fail(declaration, `${requiredClassName(declaration)} must define at least one model lifecycle method.`)
    }
    let model: ModelManifestEntry | undefined
    for (const method of methods) {
      if (method.parameters.length !== 1) {
        fail(method, `Observer method ${propertyName(method.name)} must accept one typed model parameter.`)
      }
      const modelDeclaration = classDeclarationForType(method.parameters[0]!, checker)
      const candidate = modelDeclaration ? modelByDeclaration.get(modelDeclaration) : undefined
      if (!candidate) {
        fail(method.parameters[0]!, 'Observer lifecycle methods must name a Model declared by a selected Feature.')
      }
      if (model && model.id !== candidate.id) {
        fail(method, `${requiredClassName(declaration)} cannot observe more than one Model.`)
      }
      model = candidate
    }
    const lifecycle = lifecycleOf(declaration, checker)
    if (lifecycle.start || lifecycle.drain || lifecycle.stop || lifecycle.dispose) {
      fail(declaration, `${requiredClassName(declaration)} cannot own container lifecycle phases.`)
    }
    const name = requiredClassName(declaration)
    const entry: ObserverManifestEntry = {
      id: `observer:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name,
      exportName: name,
      modelId: model!.id,
      phases: methods.map((method) => propertyName(method.name) as typeof phaseNames[number]),
      scope: 'transient',
      source: sourceOf(declaration, normalized.projectRoot),
      dependencies: [],
      lifecycle,
    }
    observerByDeclaration.set(declaration, entry)
    const complete = { ...entry, dependencies: dependenciesFor(declaration, ownerId) }
    observerByDeclaration.set(declaration, complete)
    observers.push(complete)
    return complete
  }

  function registerEvent(
    declaration: ts.ClassDeclaration,
    ownerId: string,
  ): EventManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'Event', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend Event.`)
    }
    const name = requiredClassName(declaration)
    const entry: EventManifestEntry = {
      id: `event:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name,
      exportName: name,
      dispatch: implementsNamedInterface(declaration, 'ShouldDispatchAfterCommit', checker)
        ? 'after-commit'
        : 'immediate',
      source: sourceOf(declaration, normalized.projectRoot),
    }
    eventByDeclaration.set(declaration, entry)
    events.push(entry)
    return entry
  }

  function registerListener(
    declaration: ts.ClassDeclaration,
    ownerId: string,
  ): ListenerManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'Listener', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend Listener.`)
    }
    const handle = declaration.members.find(
      (member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member)
        && propertyName(member.name) === 'handle',
    )
    if (!handle || handle.parameters.length !== 1) {
      fail(declaration, `${requiredClassName(declaration)} must define handle(event) with one typed event parameter.`)
    }
    const eventDeclaration = classDeclarationForType(handle.parameters[0]!, checker)
    const event = eventDeclaration ? eventByDeclaration.get(eventDeclaration) : undefined
    if (!event) {
      fail(
        handle.parameters[0]!,
        'Listener handle(event) must name an Event declared by a selected Feature.',
      )
    }
    const queuedAfterCommit = implementsNamedInterface(
      declaration,
      'ShouldQueueAfterCommit',
      checker,
    )
    const queued = queuedAfterCommit || implementsNamedInterface(declaration, 'ShouldQueue', checker)
    const afterCommit = implementsNamedInterface(
      declaration,
      'ShouldHandleEventsAfterCommit',
      checker,
    )
    if (queued && afterCommit) {
      fail(
        declaration,
        `${requiredClassName(declaration)} cannot combine queued and local after-commit capabilities.`,
      )
    }
    const lifecycle = lifecycleOf(declaration, checker)
    if (lifecycle.start || lifecycle.drain || lifecycle.stop) {
      fail(declaration, `${requiredClassName(declaration)} may define dispose(), but listeners cannot own application lifecycle phases.`)
    }
    const name = requiredClassName(declaration)
    const entry: ListenerManifestEntry = {
      id: `listener:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name,
      exportName: name,
      eventId: event.id,
      delivery: queuedAfterCommit
        ? 'queued-after-commit'
        : queued
          ? 'queued'
          : afterCommit
            ? 'after-commit'
          : 'local',
      access: readAccess(declaration),
      scope: 'transient',
      source: sourceOf(declaration, normalized.projectRoot),
      dependencies: [],
      lifecycle,
    }
    listenerByDeclaration.set(declaration, entry)
    const complete = { ...entry, dependencies: dependenciesFor(declaration, ownerId) }
    listenerByDeclaration.set(declaration, complete)
    listeners.push(complete)
    return complete
  }

  function registerRoute(
    declaration: ts.ClassDeclaration,
    ownerId: string,
  ): RouteManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'Route', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend Route.`)
    }
    const method = readRequiredInstanceString(declaration, 'method').toUpperCase()
    if (!['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'].includes(method)) {
      fail(declaration, `${requiredClassName(declaration)}.method is not a supported HTTP method.`)
    }
    const routePath = readRequiredInstanceString(declaration, 'path')
    if (!routePath.startsWith('/')) {
      fail(declaration, `${requiredClassName(declaration)}.path must begin with /.`)
    }
    const handle = declaration.members.find(
      (member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member)
        && propertyName(member.name) === 'handle',
    )
    if (!handle || handle.parameters.length !== 1) {
      fail(declaration, `${requiredClassName(declaration)} must define handle(request).`)
    }
    const lifecycle = lifecycleOf(declaration, checker)
    if (lifecycle.start || lifecycle.drain || lifecycle.stop) {
      fail(declaration, `${requiredClassName(declaration)} may define dispose(), but routes cannot own application lifecycle phases.`)
    }
    const name = requiredClassName(declaration)
    const access = readRequiredStaticString(declaration, 'access')
    if (access !== 'public' && !/^[a-z][a-z0-9._:-]{1,127}$/.test(access)) {
      fail(declaration, `${name}.access must be "public" or a stable ability name.`)
    }
    const entry: RouteManifestEntry = {
      id: `route:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name,
      exportName: name,
      method: method as RouteManifestEntry['method'],
      path: routePath,
      access,
      scope: 'transient',
      source: sourceOf(declaration, normalized.projectRoot),
      dependencies: [],
      lifecycle,
    }
    routeByDeclaration.set(declaration, entry)
    const complete = { ...entry, dependencies: dependenciesFor(declaration, ownerId) }
    routeByDeclaration.set(declaration, complete)
    routes.push(complete)
    return complete
  }

  function registerJob(
    declaration: ts.ClassDeclaration,
    ownerId: string,
  ): JobManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'Job', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend Job.`)
    }
    const handle = declaration.members.find(
      (member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member)
        && propertyName(member.name) === 'handle',
    )
    if (!handle || handle.parameters.length !== 1) {
      fail(declaration, `${requiredClassName(declaration)} must define handle(input).`)
    }
    const lifecycle = lifecycleOf(declaration, checker)
    if (lifecycle.start || lifecycle.drain || lifecycle.stop) {
      fail(declaration, `${requiredClassName(declaration)} may define dispose(), but jobs cannot own application lifecycle phases.`)
    }
    const name = requiredClassName(declaration)
    const retries = readOptionalStaticNumber(declaration, 'retries', 3)
    const retryDelay = readOptionalStaticNumber(declaration, 'retryDelay', 1)
    const timeout = readOptionalStaticNumber(declaration, 'timeout', 30)
    if (!Number.isInteger(retries) || retries < 0) {
      fail(declaration, `${name}.retries must be a non-negative integer.`)
    }
    if (!Number.isFinite(retryDelay) || retryDelay < 0) {
      fail(declaration, `${name}.retryDelay must be a non-negative number.`)
    }
    if (!Number.isFinite(timeout) || timeout < 1) {
      fail(declaration, `${name}.timeout must be at least one second.`)
    }
    const entry: JobManifestEntry = {
      id: `job:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name,
      exportName: name,
      scope: 'transient',
      retries,
      retryDelay,
      backoff: readOptionalStaticBoolean(declaration, 'backoff', true),
      timeout,
      access: readAccess(declaration),
      source: sourceOf(declaration, normalized.projectRoot),
      dependencies: [],
      lifecycle,
    }
    jobByDeclaration.set(declaration, entry)
    const complete = { ...entry, dependencies: dependenciesFor(declaration, ownerId) }
    jobByDeclaration.set(declaration, complete)
    jobs.push(complete)
    return complete
  }

  function registerSchedule(
    declaration: ts.ClassDeclaration,
    ownerId: string,
  ): ScheduleManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'Schedule', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend Schedule.`)
    }
    const jobDeclaration = readRequiredStaticClass(declaration, 'job', checker)
    const job = jobByDeclaration.get(jobDeclaration)
    if (!job) fail(declaration, `${requiredClassName(declaration)}.job must name a Job declared by a selected Feature.`)
    const cron = readOptionalStaticString(declaration, 'cron')
    const everySeconds = readOptionalStaticNumberValue(declaration, 'everySeconds')
    if ((cron === undefined) === (everySeconds === undefined)) {
      fail(declaration, `${requiredClassName(declaration)} must declare exactly one of static cron or static everySeconds.`)
    }
    if (cron !== undefined && cron.trim().split(/\s+/).length !== 5) {
      fail(declaration, `${requiredClassName(declaration)}.cron must use a five-field cron expression.`)
    }
    if (everySeconds !== undefined && (!Number.isInteger(everySeconds) || everySeconds < 1)) {
      fail(declaration, `${requiredClassName(declaration)}.everySeconds must be a positive integer.`)
    }
    const timeZone = readOptionalStaticString(declaration, 'timeZone') ?? 'UTC'
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format()
    } catch {
      fail(declaration, `${requiredClassName(declaration)}.timeZone must be a valid IANA time-zone name.`)
    }
    const overlap = readOptionalStaticString(declaration, 'overlap') ?? 'serialize'
    if (overlap !== 'allow' && overlap !== 'serialize') {
      fail(declaration, `${requiredClassName(declaration)}.overlap must be "allow" or "serialize".`)
    }
    const misfire = readOptionalStaticString(declaration, 'misfire') ?? 'skip'
    if (misfire !== 'skip') {
      fail(declaration, `${requiredClassName(declaration)}.misfire currently supports only "skip".`)
    }
    const entry: ScheduleManifestEntry = {
      id: `schedule:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name: requiredClassName(declaration),
      exportName: requiredClassName(declaration),
      jobId: job.id,
      cadence: cron !== undefined
        ? { kind: 'cron', expression: cron }
        : { kind: 'interval', seconds: everySeconds! },
      timeZone,
      overlap,
      misfire,
      input: readOptionalStaticJson(declaration, 'input') ?? null,
      access: readAccess(declaration),
      source: sourceOf(declaration, normalized.projectRoot),
    }
    scheduleByDeclaration.set(declaration, entry)
    schedules.push(entry)
    return entry
  }

  function registerPolicy(
    declaration: ts.ClassDeclaration,
    ownerId: string,
  ): PolicyManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'Policy', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend Policy.`)
    }
    const decide = declaration.members.find(
      (member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member)
        && propertyName(member.name) === 'decide',
    )
    if (!decide || decide.parameters.length !== 1) {
      fail(declaration, `${requiredClassName(declaration)} must define decide(request).`)
    }
    const lifecycle = lifecycleOf(declaration, checker)
    if (lifecycle.start || lifecycle.drain || lifecycle.stop) {
      fail(declaration, `${requiredClassName(declaration)} may define dispose(), but policies cannot own application lifecycle phases.`)
    }
    const name = requiredClassName(declaration)
    const abilities = readRequiredStaticStringArray(declaration, 'abilities')
    if (abilities.length === 0) fail(declaration, `${name}.abilities must contain at least one ability.`)
    const entry: PolicyManifestEntry = {
      id: `policy:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name,
      exportName: name,
      scope: 'transient',
      abilities: [...new Set(abilities)].sort(),
      source: sourceOf(declaration, normalized.projectRoot),
      dependencies: [],
      lifecycle,
    }
    policyByDeclaration.set(declaration, entry)
    const complete = { ...entry, dependencies: dependenciesFor(declaration, ownerId) }
    policyByDeclaration.set(declaration, complete)
    policies.push(complete)
    return complete
  }

  function registerSignal(declaration: ts.ClassDeclaration, ownerId: string): SignalManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'Signal', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend Signal.`)
    }
    const name = requiredClassName(declaration)
    const entry: SignalManifestEntry = {
      id: `signal:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name,
      exportName: name,
      source: sourceOf(declaration, normalized.projectRoot),
    }
    signalByDeclaration.set(declaration, entry)
    signals.push(entry)
    return entry
  }

  function registerSignalHandler(
    declaration: ts.ClassDeclaration,
    ownerId: string,
  ): SignalHandlerManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'SignalHandler', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend SignalHandler.`)
    }
    const handle = declaration.members.find(
      (member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member)
        && propertyName(member.name) === 'handle',
    )
    if (!handle || handle.parameters.length !== 1) {
      fail(declaration, `${requiredClassName(declaration)} must define handle(signal).`)
    }
    const signalDeclaration = classDeclarationForType(handle.parameters[0]!, checker)
    const signal = signalDeclaration ? signalByDeclaration.get(signalDeclaration) : undefined
    if (!signal) fail(handle.parameters[0]!, 'SignalHandler handle(signal) must name a Signal declared by a selected Feature.')
    const lifecycle = lifecycleOf(declaration, checker)
    if (lifecycle.start || lifecycle.drain || lifecycle.stop) {
      fail(declaration, `${requiredClassName(declaration)} may define dispose(), but signal handlers cannot own lifecycle phases.`)
    }
    const name = requiredClassName(declaration)
    const entry: SignalHandlerManifestEntry = {
      id: `signal-handler:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name,
      exportName: name,
      signalId: signal.id,
      access: readAccess(declaration),
      scope: 'transient',
      source: sourceOf(declaration, normalized.projectRoot),
      dependencies: [],
      lifecycle,
    }
    signalHandlerByDeclaration.set(declaration, entry)
    const complete = { ...entry, dependencies: dependenciesFor(declaration, ownerId) }
    signalHandlerByDeclaration.set(declaration, complete)
    signalHandlers.push(complete)
    return complete
  }

  function registerCommand(declaration: ts.ClassDeclaration, ownerId: string): CommandManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'Command', checker)) fail(declaration, `${requiredClassName(declaration)} must extend Command.`)
    const handle = declaration.members.find((member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member) && propertyName(member.name) === 'handle')
    if (!handle || handle.parameters.length !== 1) fail(declaration, `${requiredClassName(declaration)} must define handle(arguments_).`)
    const lifecycle = lifecycleOf(declaration, checker)
    if (lifecycle.start || lifecycle.drain || lifecycle.stop) fail(declaration, `${requiredClassName(declaration)} may define dispose(), but commands cannot own application lifecycle phases.`)
    const name = requiredClassName(declaration)
    const command = readRequiredStaticString(declaration, 'name')
    if (!/^[a-z][a-z0-9]*(?::[a-z][a-z0-9-]*)*$/.test(command)) fail(declaration, `${name}.name must be a stable colon-delimited command name.`)
    const entry: CommandManifestEntry = {
      id: `command:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name,
      exportName: name,
      command,
      description: readOptionalStaticString(declaration, 'description') ?? '',
      access: readAccess(declaration),
      scope: 'transient',
      source: sourceOf(declaration, normalized.projectRoot),
      dependencies: [],
      lifecycle,
    }
    commandByDeclaration.set(declaration, entry)
    const complete = { ...entry, dependencies: dependenciesFor(declaration, ownerId) }
    commandByDeclaration.set(declaration, complete)
    commands.push(complete)
    return complete
  }
}

interface NormalizedOptions {
  readonly tsconfigPath: string
  readonly applicationFile: string
  readonly sourceRoot: string
  readonly outputRoot: string
  readonly artifactsDirectory: string
  readonly applicationExport: string
  readonly projectRoot: string
}

function normalizeOptions(options: CompileApplicationOptions): NormalizedOptions {
  const tsconfigPath = path.resolve(options.tsconfigPath)
  return {
    tsconfigPath,
    applicationFile: path.resolve(options.applicationFile),
    sourceRoot: path.resolve(options.sourceRoot),
    outputRoot: path.resolve(options.outputRoot),
    artifactsDirectory: path.resolve(options.artifactsDirectory),
    applicationExport: options.applicationExport ?? 'Application',
    projectRoot: path.dirname(tsconfigPath),
  }
}

function createProgram(tsconfigPath: string): ts.Program {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
  if (configFile.error) {
    throw new CanopyCompilationError(formatDiagnostics([configFile.error]))
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsconfigPath))
  if (parsed.errors.length > 0) {
    throw new CanopyCompilationError(formatDiagnostics(parsed.errors))
  }
  return ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options })
}

function assertValidProgram(program: ts.Program): void {
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length > 0) {
    throw new CanopyCompilationError(formatDiagnostics(diagnostics))
  }
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => ts.sys.newLine,
  })
}

function findExportedClass(source: ts.SourceFile, exportName: string): ts.ClassDeclaration {
  const declaration = source.statements.find(
    (statement): statement is ts.ClassDeclaration => ts.isClassDeclaration(statement)
      && statement.name?.text === exportName
      && hasModifier(statement, ts.SyntaxKind.ExportKeyword),
  )
  if (!declaration) {
    throw new CanopyCompilationError(`Expected exported Application class ${exportName} in ${source.fileName}.`)
  }
  return declaration
}

function assertDeclarationOnly(declaration: ts.ClassDeclaration, kind: 'Application' | 'Feature'): void {
  for (const member of declaration.members) {
    if (!ts.isPropertyDeclaration(member)) {
      fail(member, `${kind} declarations may contain declarative fields only.`)
    }
    const name = propertyName(member.name)
    if (!name || !DECLARATION_FIELDS.has(name) || hasModifier(member, ts.SyntaxKind.StaticKeyword)) {
      fail(member, `${kind} field ${name ?? member.name.getText()} is not a supported declaration field.`)
    }
  }
}

function assertConfigurationDeclaration(declaration: ts.ClassDeclaration): void {
  for (const member of declaration.members) {
    if (!ts.isPropertyDeclaration(member) || hasModifier(member, ts.SyntaxKind.StaticKeyword)) {
      fail(member, 'Configuration declarations may contain instance properties only.')
    }
  }
}

function readClassArray(
  declaration: ts.ClassDeclaration,
  name: string,
  checker: ts.TypeChecker,
): readonly ts.ClassDeclaration[] {
  const property = findInstanceProperty(declaration, name)
  if (!property) return []
  if (!property.initializer || !ts.isArrayLiteralExpression(property.initializer)) {
    fail(property, `${name} must be a literal array of direct class references.`)
  }
  return property.initializer.elements.map((element) => {
    if (ts.isSpreadElement(element)) {
      fail(element, `${name} may not contain spread elements.`)
    }
    const resolved = resolveClassReference(element, checker)
    if (!resolved) fail(element, `${element.getText()} does not resolve to a class declaration.`)
    return resolved
  })
}

function resolveClassReference(node: ts.Expression, checker: ts.TypeChecker): ts.ClassDeclaration | undefined {
  let symbol = checker.getSymbolAtLocation(node)
  if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    symbol = checker.getAliasedSymbol(symbol)
  }
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0]
  return declaration && ts.isClassDeclaration(declaration) ? declaration : undefined
}

function classDeclarationForType(
  parameter: ts.ParameterDeclaration,
  checker: ts.TypeChecker,
): ts.ClassDeclaration | undefined {
  const type = checker.getNonNullableType(checker.getTypeAtLocation(parameter))
  const symbol = type.getSymbol()
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0]
  return declaration && ts.isClassDeclaration(declaration) ? declaration : undefined
}

function roleInjectionKind(call: ts.CallExpression): 'required' | 'optional' | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined
  if (call.expression.name.text === 'inject'
    && call.expression.expression.kind === ts.SyntaxKind.ThisKeyword) return 'required'
  const receiver = call.expression.expression
  return call.expression.name.text === 'optional'
    && ts.isPropertyAccessExpression(receiver)
    && receiver.name.text === 'inject'
    && receiver.expression.kind === ts.SyntaxKind.ThisKeyword
    ? 'optional'
    : undefined
}

function compileConfigurationProperty(
  configurationName: string,
  property: ts.PropertyDeclaration,
  checker: ts.TypeChecker,
  projectRoot: string,
): ConfigurationPropertyManifest {
  const name = propertyName(property.name)
  if (!name) fail(property, 'Configuration property names must be identifiers or string literals.')
  const type = checker.getTypeAtLocation(property)
  const nonNullable = checker.getNonNullableType(type)
  const secret = isNamedCoreType(nonNullable, 'SecretString')
  const literalValues = literalUnionValues(nonNullable)
  const kind = secret
    ? 'secret-string'
    : literalValues
    ? 'literal-union'
    : (nonNullable.flags & ts.TypeFlags.StringLike) !== 0
      ? 'string'
      : (nonNullable.flags & ts.TypeFlags.NumberLike) !== 0
        ? 'number'
        : (nonNullable.flags & ts.TypeFlags.BooleanLike) !== 0
          ? 'boolean'
          : undefined
  if (!kind) {
    fail(property, `Configuration property ${name} must use a supported scalar or literal union type.`)
  }

  const defaultValue = property.initializer
    ? readScalarInitializer(property.initializer)
    : undefined
  const group = toScreamingSnake(configurationName.replace(/Config$/, ''))
  const result: ConfigurationPropertyManifest = {
    name,
    environmentKey: `${group}_${toScreamingSnake(name)}`,
    kind,
    ...(literalValues ? { allowedValues: literalValues } : {}),
    optional: Boolean(property.questionToken) || includesUndefined(type),
    sensitive: secret,
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    source: sourceOf(property, projectRoot),
  }
  return result
}

function literalUnionValues(type: ts.Type): readonly ConfigurationDefault[] | undefined {
  if (!type.isUnion()) return undefined
  const values: ConfigurationDefault[] = []
  for (const member of type.types) {
    if (member.isStringLiteral() || member.isNumberLiteral()) {
      values.push(member.value)
    } else if ((member.flags & ts.TypeFlags.BooleanLiteral) !== 0) {
      values.push((member as ts.Type & { intrinsicName?: string }).intrinsicName === 'true')
    } else {
      return undefined
    }
  }
  return values.length > 0 ? values : undefined
}

function isNamedCoreType(type: ts.Type, name: string): boolean {
  const declaration = type.getSymbol()?.declarations?.[0]
  return Boolean(
    declaration
      && ts.isClassDeclaration(declaration)
      && declaration.name?.text === name
      && isCoreDeclaration(declaration),
  )
}

function readScalarInitializer(initializer: ts.Expression): ConfigurationDefault {
  if (ts.isStringLiteral(initializer) || ts.isNumericLiteral(initializer)) {
    return ts.isNumericLiteral(initializer) ? Number(initializer.text) : initializer.text
  }
  if (initializer.kind === ts.SyntaxKind.TrueKeyword) return true
  if (initializer.kind === ts.SyntaxKind.FalseKeyword) return false
  fail(initializer, 'Configuration defaults must be literal strings, numbers, or booleans.')
}

function lifecycleOf(declaration: ts.ClassDeclaration, checker: ts.TypeChecker) {
  const type = checker.getTypeAtLocation(declaration)
  return {
    start: Boolean(type.getProperty('start')),
    drain: Boolean(type.getProperty('drain')),
    stop: Boolean(type.getProperty('stop')),
    dispose: Boolean(type.getProperty('dispose')),
  }
}

function implementsNamedInterface(
  declaration: ts.ClassDeclaration,
  name: string,
  checker: ts.TypeChecker,
): boolean {
  return declaration.heritageClauses
    ?.filter((clause) => clause.token === ts.SyntaxKind.ImplementsKeyword)
    .some((clause) => clause.types.some((type) => {
      const referenced = resolveNamedDeclaration(type.expression, checker)
      return referenced?.name?.text === name && isCoreDeclaration(referenced)
    })) ?? false
}

function extendsNamedClass(
  declaration: ts.ClassDeclaration,
  name: string,
  checker: ts.TypeChecker,
): boolean {
  for (const clause of declaration.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue
    for (const type of clause.types) {
      const base = resolveClassReference(type.expression, checker)
      if (base?.name?.text === name && isCoreDeclaration(base)) return true
      if (base && extendsNamedClass(base, name, checker)) return true
    }
  }
  return false
}

function resolveNamedDeclaration(
  node: ts.Expression,
  checker: ts.TypeChecker,
): ts.Declaration & { readonly name?: ts.Identifier } | undefined {
  let symbol = checker.getSymbolAtLocation(node)
  if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    symbol = checker.getAliasedSymbol(symbol)
  }
  return symbol?.declarations?.find(
    (declaration): declaration is ts.Declaration & { readonly name?: ts.Identifier } =>
      'name' in declaration,
  )
}

function isCoreDeclaration(declaration: ts.Declaration): boolean {
  const source = declaration.getSourceFile().fileName.split(path.sep).join('/')
  return source.includes('/packages/core/') || source.includes('/@canopy/core/')
}

function builtinIdForDeclaration(declaration: ts.ClassDeclaration): string | undefined {
  const name = requiredClassName(declaration)
  if (name !== 'ActionBus' && name !== 'QueryBus' && name !== 'CurrentExecution'
    && name !== 'CurrentJob' && name !== 'UnitOfWork' && name !== 'Authorization'
    && name !== 'Mailer' && name !== 'Sms' && name !== 'DeliveryLedger' && name !== 'Logger') return undefined
  const source = declaration.getSourceFile().fileName.split(path.sep).join('/')
  if (!source.includes('/packages/core/') && !source.includes('/@canopy/core/')) return undefined
  if (name === 'ActionBus') return 'canopy:action-bus'
  if (name === 'QueryBus') return 'canopy:query-bus'
  if (name === 'CurrentExecution') return 'canopy:current-execution'
  if (name === 'CurrentJob') return 'canopy:current-job'
  if (name === 'Authorization') return 'canopy:authorization'
  if (name === 'Mailer') return 'canopy:mailer'
  if (name === 'Sms') return 'canopy:sms'
  if (name === 'DeliveryLedger') return 'canopy:delivery-ledger'
  if (name === 'Logger') return 'canopy:logger'
  return 'canopy:unit-of-work'
}

function providerCapabilityForDeclaration(
  declaration: ts.ClassDeclaration,
): ProviderManifestEntry['capabilities'][number] | undefined {
  const name = requiredClassName(declaration)
  if (name !== 'Auth' && name !== 'TransactionManager' && name !== 'QueueManager'
    && name !== 'Cache' && name !== 'MailTransport' && name !== 'SmsTransport'
    && name !== 'Telemetry' && name !== 'ObservationRecorder') return undefined
  const source = declaration.getSourceFile().fileName.split(path.sep).join('/')
  return source.includes('/packages/core/') || source.includes('/@canopy/core/')
    ? name === 'Auth' ? 'authentication'
      : name === 'TransactionManager' ? 'transactions'
        : name === 'QueueManager' ? 'queues'
          : name === 'Cache' ? 'cache'
            : name === 'MailTransport' ? 'mail'
              : name === 'SmsTransport' ? 'sms'
                : name === 'Telemetry' ? 'telemetry' : 'observations'
    : undefined
}

function assertConcreteClass(declaration: ts.ClassDeclaration): void {
  if (hasModifier(declaration, ts.SyntaxKind.AbstractKeyword)) {
    fail(declaration, `${requiredClassName(declaration)} must be concrete before it can be registered.`)
  }
}

function renderRegistry(
  application: RegisteredClass,
  configurations: readonly RegisteredClass[],
  providers: readonly RegisteredClass[],
  operations: readonly RegisteredClass[],
  models: readonly RegisteredClass[],
  observers: readonly RegisteredClass[],
  routes: readonly RegisteredClass[],
  events: readonly RegisteredClass[],
  listeners: readonly RegisteredClass[],
  jobs: readonly RegisteredClass[],
  schedules: readonly RegisteredClass[],
  policies: readonly RegisteredClass[],
  signals: readonly RegisteredClass[],
  signalHandlers: readonly RegisteredClass[],
  commands: readonly RegisteredClass[],
  buildHash: string,
  options: NormalizedOptions,
): string {
  const registrations = [
    application,
    ...configurations,
    ...providers,
    ...operations,
    ...models,
    ...observers,
    ...routes,
    ...events,
    ...listeners,
    ...jobs,
    ...schedules,
    ...policies,
    ...signals,
    ...signalHandlers,
    ...commands,
  ]
    .sort((left, right) => left.id.localeCompare(right.id))
  const imports = registrations.map((registration, index) => {
    const sourceFile = registration.declaration.getSourceFile().fileName
    const relativeSource = path.relative(options.sourceRoot, sourceFile)
    if (relativeSource.startsWith('..') || path.isAbsolute(relativeSource)) {
      fail(registration.declaration, 'Registry classes must be emitted from within the configured source root.')
    }
    const outputFile = path.join(options.outputRoot, relativeSource).replace(/\.(?:mts|cts|tsx|ts)$/, '.js')
    let specifier = path.relative(options.artifactsDirectory, outputFile).split(path.sep).join('/')
    if (!specifier.startsWith('.')) specifier = `./${specifier}`
    return `import { ${requiredClassName(registration.declaration)} as C${index} } from ${JSON.stringify(specifier)}`
  })
  const entries = registrations.map((registration, index) => `  ${JSON.stringify(registration.id)}: C${index},`)
  return [
    '// Generated by @canopy/compiler. Do not edit.',
    ...imports,
    '',
    `export const formatVersion = ${MANIFEST_FORMAT_VERSION}`,
    `export const buildHash = ${JSON.stringify(buildHash)}`,
    'export const constructors = Object.freeze({',
    ...entries,
    '})',
    '',
  ].join('\n')
}

function readRequiredInstanceString(declaration: ts.ClassDeclaration, name: string): string {
  const property = findInstanceProperty(declaration, name)
  if (!property?.initializer || !ts.isStringLiteral(property.initializer) || property.initializer.text.length === 0) {
    fail(declaration, `${requiredClassName(declaration)}.${name} must be a non-empty string literal.`)
  }
  return property.initializer.text
}

function readRequiredStaticString(declaration: ts.ClassDeclaration, name: string): string {
  const property = declaration.members.find(
    (member): member is ts.PropertyDeclaration => ts.isPropertyDeclaration(member)
      && hasModifier(member, ts.SyntaxKind.StaticKeyword)
      && propertyName(member.name) === name,
  )
  if (!property?.initializer || !ts.isStringLiteral(property.initializer) || property.initializer.text.length === 0) {
    fail(declaration, `${requiredClassName(declaration)} must declare static ${name} as a non-empty string literal.`)
  }
  return property.initializer.text
}

function readAccess(declaration: ts.ClassDeclaration): string {
  const access = readRequiredStaticString(declaration, 'access')
  if (access !== 'public' && !/^[a-z][a-z0-9._:-]{1,127}$/.test(access)) {
    fail(declaration, `${requiredClassName(declaration)}.access must be "public" or a stable ability name.`)
  }
  return access
}

function staticProperty(
  declaration: ts.ClassDeclaration,
  name: string,
): ts.PropertyDeclaration | undefined {
  return declaration.members.find(
    (member): member is ts.PropertyDeclaration => ts.isPropertyDeclaration(member)
      && hasModifier(member, ts.SyntaxKind.StaticKeyword)
      && propertyName(member.name) === name,
  )
}

function readOptionalStaticString(
  declaration: ts.ClassDeclaration,
  name: string,
): string | undefined {
  const property = staticProperty(declaration, name)
  if (!property) return undefined
  if (!property.initializer || !ts.isStringLiteral(property.initializer)
    || property.initializer.text.length === 0) {
    fail(property, `${requiredClassName(declaration)}.${name} must be a non-empty string literal.`)
  }
  return property.initializer.text
}

function readRequiredStaticStringArray(
  declaration: ts.ClassDeclaration,
  name: string,
): readonly string[] {
  const property = staticProperty(declaration, name)
  if (!property?.initializer || !ts.isArrayLiteralExpression(property.initializer)) {
    fail(declaration, `${requiredClassName(declaration)} must declare static ${name} as a literal string array.`)
  }
  return property.initializer.elements.map((element) => {
    if (!ts.isStringLiteral(element) || element.text.length === 0) {
      fail(element, `${requiredClassName(declaration)}.${name} may contain only non-empty string literals.`)
    }
    return element.text
  })
}

function readOptionalStaticNumberValue(
  declaration: ts.ClassDeclaration,
  name: string,
): number | undefined {
  const property = staticProperty(declaration, name)
  if (!property) return undefined
  if (!property.initializer || !ts.isNumericLiteral(property.initializer)) {
    fail(property, `${requiredClassName(declaration)}.${name} must be a numeric literal.`)
  }
  return Number(property.initializer.text)
}

function readRequiredStaticClass(
  declaration: ts.ClassDeclaration,
  name: string,
  checker: ts.TypeChecker,
): ts.ClassDeclaration {
  const property = staticProperty(declaration, name)
  if (!property?.initializer) {
    fail(declaration, `${requiredClassName(declaration)} must declare static ${name} as a direct class reference.`)
  }
  const resolved = resolveClassReference(property.initializer, checker)
  if (!resolved) fail(property, `${requiredClassName(declaration)}.${name} must be a direct class reference.`)
  return resolved
}

function readOptionalStaticJson(declaration: ts.ClassDeclaration, name: string): unknown {
  const property = staticProperty(declaration, name)
  return property?.initializer ? readJsonLiteral(property.initializer) : undefined
}

function readJsonLiteral(node: ts.Expression): unknown {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
    || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) {
    return readJsonLiteral(node.expression)
  }
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return ts.isNumericLiteral(node) ? Number(node.text) : node.text
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken
    && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text)
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element) => {
      if (ts.isSpreadElement(element)) fail(element, 'Schedule input may not contain spreads.')
      return readJsonLiteral(element)
    })
  }
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(node.properties.map((property) => {
      if (!ts.isPropertyAssignment(property)) {
        fail(property, 'Schedule input must use explicit JSON property assignments.')
      }
      const key = propertyName(property.name)
      if (!key) fail(property, 'Schedule input property names must be literal.')
      return [key, readJsonLiteral(property.initializer)]
    }))
  }
  fail(node, 'Schedule input must be a JSON literal so Cultivate and the manifest can inspect it.')
}

function validIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(value)
}

function validQualifiedIdentifier(value: string): boolean {
  const parts = value.split('.')
  return parts.length > 0 && parts.length <= 2 && parts.every(validIdentifier)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === 'string')
}

function readOptionalStaticNumber(
  declaration: ts.ClassDeclaration,
  name: string,
  fallback: number,
): number {
  const property = declaration.members.find(
    (member): member is ts.PropertyDeclaration => ts.isPropertyDeclaration(member)
      && hasModifier(member, ts.SyntaxKind.StaticKeyword)
      && propertyName(member.name) === name,
  )
  if (!property) return fallback
  if (!property.initializer || !ts.isNumericLiteral(property.initializer)) {
    fail(property, `${requiredClassName(declaration)}.${name} must be a numeric literal.`)
  }
  return Number(property.initializer.text)
}

function readOptionalStaticBoolean(
  declaration: ts.ClassDeclaration,
  name: string,
  fallback: boolean,
): boolean {
  const property = declaration.members.find(
    (member): member is ts.PropertyDeclaration => ts.isPropertyDeclaration(member)
      && hasModifier(member, ts.SyntaxKind.StaticKeyword)
      && propertyName(member.name) === name,
  )
  if (!property) return fallback
  if (property.initializer?.kind === ts.SyntaxKind.TrueKeyword) return true
  if (property.initializer?.kind === ts.SyntaxKind.FalseKeyword) return false
  fail(property, `${requiredClassName(declaration)}.${name} must be a boolean literal.`)
}

function findInstanceProperty(declaration: ts.ClassDeclaration, name: string): ts.PropertyDeclaration | undefined {
  return declaration.members.find(
    (member): member is ts.PropertyDeclaration => ts.isPropertyDeclaration(member)
      && !hasModifier(member, ts.SyntaxKind.StaticKeyword)
      && propertyName(member.name) === name,
  )
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined
}

function requiredClassName(declaration: ts.ClassDeclaration): string {
  if (!declaration.name) fail(declaration, 'Canopy declarations must use named classes.')
  return declaration.name.text
}

function sourceOf(node: ts.Node, projectRoot: string): SourceProvenance {
  const source = node.getSourceFile()
  const position = source.getLineAndCharacterOfPosition(node.getStart(source))
  return {
    file: path.relative(projectRoot, source.fileName).split(path.sep).join('/'),
    line: position.line + 1,
    column: position.character + 1,
  }
}

function includesUndefined(type: ts.Type): boolean {
  return type.isUnion() && type.types.some((member) => (member.flags & ts.TypeFlags.Undefined) !== 0)
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind))
}

function assertUnique<T>(items: readonly T[], identity: (item: T) => string, label: string): void {
  const seen = new Set<string>()
  for (const item of items) {
    const id = identity(item)
    if (seen.has(id)) throw new CanopyCompilationError(`Duplicate ${label}: ${id}`)
    seen.add(id)
  }
}

function assertAcyclicProviderGraph(providers: readonly ProviderManifestEntry[]): void {
  const byId = new Map(providers.map((provider) => [provider.id, provider]))
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (id: string, path: readonly string[]): void => {
    if (visiting.has(id)) {
      throw new CanopyCompilationError(`Dependency cycle: ${[...path, id].join(' -> ')}`)
    }
    if (visited.has(id)) return
    const provider = byId.get(id)
    if (!provider) return
    visiting.add(id)
    for (const dependency of provider.dependencies) {
      if (dependency.targetId && byId.has(dependency.targetId)) {
        visit(dependency.targetId, [...path, id])
      }
    }
    visiting.delete(id)
    visited.add(id)
  }

  for (const provider of providers) visit(provider.id, [])
}

function assertScopeSafety(providers: readonly ProviderManifestEntry[]): void {
  const byId = new Map(providers.map((provider) => [provider.id, provider]))

  const reachesExecutionScope = (id: string, visited: Set<string>): boolean => {
    if (visited.has(id)) return false
    visited.add(id)
    const provider = byId.get(id)
    if (!provider) return false
    if (provider.scope === 'execution') return true
    return provider.dependencies.some(
      (dependency) => dependency.targetId
        && reachesExecutionScope(dependency.targetId, visited),
    )
  }

  for (const provider of providers) {
    if (provider.scope !== 'singleton') continue
    for (const dependency of provider.dependencies) {
      if (dependency.targetId && reachesExecutionScope(dependency.targetId, new Set())) {
        throw new CanopyCompilationError(
          `Singleton ${provider.id} cannot depend on execution-scoped ${dependency.targetId}.`,
        )
      }
    }
  }
}

function byId(left: { readonly id: string }, right: { readonly id: string }): number {
  return left.id.localeCompare(right.id)
}

function toKebabCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase()
}

function toScreamingSnake(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/-/g, '_').toUpperCase()
}

function fail(node: ts.Node, message: string): never {
  const source = node.getSourceFile()
  const position = source.getLineAndCharacterOfPosition(node.getStart(source))
  throw new CanopyCompilationError(`${source.fileName}:${position.line + 1}:${position.character + 1} ${message}`)
}

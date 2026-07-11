import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { fork, spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { compileApplication } from '@canopy/compiler'
import { HonoHttpHost } from '@canopy/http-hono'
import { cancelQueueJob, listQueueJobs, retryQueueJob } from '@canopy/queue-pg-boss'
import type { LogFormat, LogLevel, QueueEnvelope } from '@canopy/core'
import { Canopy } from '@canopy/runtime'
import { listenUndergrowth, pruneUndergrowth } from '@canopy/undergrowth'
import { Pool } from 'pg'

import { HotReloadSupervisor, type HotReloadTarget } from './hot-reload.js'

export interface ArborIo {
  readonly out: (message: string) => void
  readonly error: (message: string) => void
  readonly run?: (
    command: string,
    arguments_: readonly string[],
    cwd: string,
    environment: NodeJS.ProcessEnv,
  ) => Promise<number>
}

export class ArborCommandError extends Error {
  override readonly name = 'ArborCommandError'
}

const help = `Canopy Arbor

Usage: arbor <command> [arguments]

Build and inspect:
  build                 Compile the application manifest and registry
  route:list            List compiled HTTP routes
  model:list            List models and physical storage ownership
  graph                 Summarize the compiled application graph
  cultivate             Generate Cultivate-readable application knowledge
  add undergrowth       Install and wire the Undergrowth development debugger
  delivery:list         List durable mail and SMS deliveries
  delivery:retry <id>   Redrive a failed or undelivered delivery
  queue:list            List durable queue jobs
  queue:failed          List terminally failed queue jobs
  queue:retry <id>      Retry a terminally failed queue job
  queue:cancel <id>     Cancel a queued job
  auth:identities       List identities without credential material
  auth:sessions         List browser sessions [--identity=id]
  auth:tokens           List bearer tokens [--identity=id]
  auth:revoke-session <id>
  auth:revoke-token <id>
  auth:prune            Remove expired authentication artifacts
  auth:storage          Describe auth table ownership
  journal:list          List durable domain facts
  outbox:list           List transactional outbox records
  cache:list            List cache keys without values
  cache:forget <key>    Remove one cache entry
  cache:prune           Remove expired cache entries
  schedule:status       Show durable schedule enablement
  schedule:enable <id>
  schedule:disable <id>
  schedule:run <id>     Manually enqueue scheduled work
  event:list            List events and dispatch timing
  listener:list         List listeners and delivery modes
  observer:list         List model observers and phases
  job:list              List jobs and retry policies
  schedule:list         List schedules and targets
  policy:list           List policies and abilities
  command:list          List application console commands

Generate:
  new <Name> [--directory=path]
  make:feature <Name>
  make:model <Feature/Name>
  make:action <Feature/Name> --public|--ability=<ability>
  make:query <Feature/Name> --public|--ability=<ability>
  make:route <Feature/Name> --method=GET --path=/path --public|--ability=<ability>
  make:event <Feature/Name>
  make:listener <Feature/Name> --event=Event [--queued|--after-commit|--queued-after-commit] --public|--ability=<ability>
  make:signal <Feature/Name>
  make:signal-handler <Feature/Name> --signal=Signal --public|--ability=<ability>
  make:observer <Feature/Name> --model=Model
  make:job <Feature/Name> --public|--ability=<ability>
  make:schedule <Feature/Name> --job=Job (--cron="..."|--every=seconds) --public|--ability=<ability>
  make:policy <Feature/Name> --abilities=one,two
  make:config <Feature/Name>
  make:provider <Feature/Name>
  make:service <Feature/Name>
  make:command <Feature/Name> [--name=feature:command] --public|--ability=<ability>
  make:migration <Name>
  make:test <Feature/Name>

Runtime:
  serve                 Start the HTTP role
  work                  Start the queue worker role
  schedule              Start the scheduler role
  dev                    Start all roles and hot reload valid src/ changes
  migrate               Apply pending forward migrations
  migrate:status        Show migration state
  db:studio             Browse PostgreSQL with Drizzle Studio [--host=127.0.0.1] [--port=4983] [--verbose]
  undergrowth           Explore correlated runtime evidence [--host=127.0.0.1] [--port=4400]
  undergrowth:prune     Enforce Undergrowth retention [--days=7] [--maximum=50000]
`

export async function runArbor(
  arguments_: readonly string[],
  cwd = process.cwd(),
  io: ArborIo = { out: console.log, error: console.error },
): Promise<number> {
  const [command = 'help', ...args] = arguments_
  try {
    if (command === 'help' || command === '--help' || command === '-h') {
      io.out(help)
      return 0
    }
    if (command === 'build') {
      const result = await buildApplication(cwd)
      io.out(`Built ${result.manifest.applicationId} (${result.manifest.buildHash.slice(0, 12)})`)
      return 0
    }
    if (command === 'cultivate') {
      const result = await buildApplication(cwd)
      io.out(`Cultivated ${result.manifest.applicationId} at .canopy/cultivate.json`)
      return 0
    }
    if (command === 'serve' || command === 'work' || command === 'schedule' || command === 'dev') {
      await runRuntimeCommand(command, cwd, args, io)
      return 0
    }
    if (command === 'db:studio') {
      return await runDatabaseStudio(cwd, args, io)
    }
    if (command === 'add' && args[0] === 'undergrowth') {
      await addUndergrowth(cwd)
      io.out('Installed Undergrowth. Run arbor migrate, then arbor undergrowth.')
      return 0
    }
    if (command === 'undergrowth') {
      await runUndergrowth(cwd, args, io)
      return 0
    }
    if (command === 'undergrowth:prune') {
      const connectionString = await databaseConnection(cwd, args)
      const count = await pruneUndergrowth(connectionString, {
        retentionDays: numberOption(args, 'days', 7),
        maximumObservations: positiveIntegerOption(args, 'maximum', 50_000),
      })
      io.out(`Pruned ${count} Undergrowth observation${count === 1 ? '' : 's'}.`)
      return 0
    }
    if (command === 'test') {
      return await runProcess(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['test', ...args], cwd)
    }
    if (command === 'route:list' || command === 'model:list' || command === 'graph') {
      const manifest = (await buildApplication(cwd)).manifest as unknown as Record<string, unknown>
      if (command === 'route:list') {
        const routes = manifest.routes as Array<{ method: string; path: string; id: string; access: string }>
        for (const route of routes) io.out(`${route.method.padEnd(7)} ${route.path.padEnd(32)} ${route.access.padEnd(24)} ${route.id}`)
      } else if (command === 'model:list') {
        const models = manifest.models as Array<{
          id: string
          storage: { kind: 'entity-state' } | { kind: 'table'; table: string; primaryKey: string; versionColumn?: string }
        }>
        for (const model of models) {
          const storage = model.storage.kind === 'entity-state'
            ? 'canopy canopy_entity_states'
            : `external ${model.storage.table} key=${model.storage.primaryKey} version=${model.storage.versionColumn ?? 'xmin'}`
          io.out(`${model.id} ${storage}`)
        }
      } else {
        for (const field of ['features', 'providers', 'models', 'observers', 'actions', 'queries', 'routes', 'events', 'listeners', 'signals', 'signalHandlers', 'jobs', 'schedules', 'policies']) {
          io.out(`${field.padEnd(16)} ${Array.isArray(manifest[field]) ? manifest[field].length : 0}`)
        }
      }
      return 0
    }
    const inspection = inspectionField(command)
    if (inspection) {
      const manifest = (await buildApplication(cwd)).manifest as unknown as Record<string, unknown>
      for (const entry of manifest[inspection] as Array<Record<string, unknown>>) io.out(formatInspection(inspection, entry))
      return 0
    }
    if (command === 'delivery:list') {
      await withDatabase(cwd, args, async (pool) => {
        const result = await pool.query<{ id: string; channel: string; state: string; provider_message_id: string | null; updated_at: Date }>(`
          SELECT id, channel, state, provider_message_id, updated_at
          FROM canopy_delivery_messages ORDER BY updated_at DESC, id LIMIT 100
        `)
        for (const row of result.rows) io.out(`${row.channel.padEnd(5)} ${row.state.padEnd(12)} ${row.id} ${row.provider_message_id ?? '-'} ${row.updated_at.toISOString()}`)
      })
      return 0
    }
    if (command === 'migrate' || command === 'migrate:status') {
      await withDatabase(cwd, args, async (pool) => {
        const migrations = await discoverMigrations(cwd)
        if (command === 'migrate') {
          const applied = await applyMigrations(pool, migrations)
          if (applied.length === 0) io.out('Nothing to migrate.')
          for (const id of applied) io.out(`Migrated ${id}`)
        } else {
          const status = await migrationStatus(pool, migrations)
          for (const entry of status) io.out(`${entry.state.padEnd(8)} ${entry.id}`)
        }
      })
      return 0
    }
    if (command === 'delivery:retry') {
      const id = required(args[0], 'delivery:retry requires a message ID.')
      await withDatabase(cwd, args.slice(1), (pool) => redriveDelivery(pool, id))
      io.out(`Queued delivery ${id} for redrive.`)
      return 0
    }
    if (command === 'queue:list' || command === 'queue:failed') {
      const connectionString = await databaseConnection(cwd, args)
      for (const job of await listQueueJobs(connectionString, command === 'queue:failed' ? 'failed' : undefined)) {
        io.out(`${job.state.padEnd(10)} ${job.id} attempts=${job.retryCount}/${job.retryLimit + 1}`)
      }
      return 0
    }
    if (command === 'queue:retry' || command === 'queue:cancel') {
      const id = required(args[0], `${command} requires a job ID.`)
      const connectionString = await databaseConnection(cwd, args.slice(1))
      if (command === 'queue:retry') await retryQueueJob(connectionString, id)
      else await cancelQueueJob(connectionString, id)
      io.out(`${command === 'queue:retry' ? 'Retried' : 'Cancelled'} queue job ${id}.`)
      return 0
    }
    if (command === 'auth:storage') {
      await describeAuthStorage(cwd, args, io)
      return 0
    }
    if (command === 'auth:identities' || command === 'auth:sessions' || command === 'auth:tokens') {
      await withDatabase(cwd, args, async (pool) => listAuth(pool, command, option(args, 'identity'), io))
      return 0
    }
    if (command === 'auth:revoke-session' || command === 'auth:revoke-token') {
      const id = required(args[0], `${command} requires an ID.`)
      await withDatabase(cwd, args.slice(1), (pool) => revokeAuth(pool, command, id))
      io.out(`Revoked ${command === 'auth:revoke-session' ? 'session' : 'access token'} ${id}.`)
      return 0
    }
    if (command === 'auth:prune') {
      await withDatabase(cwd, args, async (pool) => {
        const result = await pool.query(`
          WITH challenges AS (
            DELETE FROM canopy_auth_challenges WHERE expires_at < now() - interval '7 days' OR consumed_at < now() - interval '7 days' RETURNING 1
          ), limits AS (
            DELETE FROM canopy_auth_rate_limits WHERE window_started_at < now() - interval '7 days' AND (blocked_until IS NULL OR blocked_until < now()) RETURNING 1
          ), sessions AS (
            DELETE FROM canopy_auth_sessions WHERE expires_at < now() - interval '30 days' OR revoked_at < now() - interval '30 days' RETURNING 1
          ) SELECT (SELECT count(*) FROM challenges) + (SELECT count(*) FROM limits) + (SELECT count(*) FROM sessions) AS count
        `)
        io.out(`Pruned ${String(result.rows[0]?.count ?? 0)} authentication records.`)
      })
      return 0
    }
    if (command === 'journal:list' || command === 'outbox:list' || command === 'cache:list') {
      await withDatabase(cwd, args, (pool) => listInfrastructure(pool, command, io))
      return 0
    }
    if (command === 'cache:forget' || command === 'cache:prune') {
      await withDatabase(cwd, command === 'cache:forget' ? args.slice(1) : args, async (pool) => {
        const result = command === 'cache:forget'
          ? await pool.query('DELETE FROM canopy_cache_entries WHERE key = $1', [required(args[0], 'cache:forget requires a key.')])
          : await pool.query('DELETE FROM canopy_cache_entries WHERE expires_at IS NOT NULL AND expires_at <= now()')
        io.out(`${command === 'cache:forget' ? 'Forgot' : 'Pruned'} ${result.rowCount ?? 0} cache entr${result.rowCount === 1 ? 'y' : 'ies'}.`)
      })
      return 0
    }
    if (command === 'schedule:status' || command === 'schedule:enable' || command === 'schedule:disable' || command === 'schedule:run') {
      await operateSchedule(command, cwd, args, io)
      return 0
    }
    if (command === 'make:feature') {
      await makeFeature(cwd, required(args[0], 'Feature name is required.'))
      io.out(`Created Feature ${args[0]}`)
      return 0
    }
    if (command === 'new') {
      const name = required(args[0], 'Application name is required.')
      const directory = path.resolve(cwd, option(args.slice(1), 'directory') ?? kebab(name))
      await makeApplication(directory, name)
      io.out(`Created Canopy application at ${directory}`)
      return 0
    }
    if (command === 'make:migration') {
      const file = await makeMigration(cwd, required(args[0], 'Migration name is required.'))
      io.out(`Created ${path.relative(cwd, file)}`)
      return 0
    }
    if (command === 'make:test') {
      const file = await makeTest(cwd, parseTarget(required(args[0], 'make:test requires Feature/Name.')))
      io.out(`Created ${path.relative(cwd, file)}`)
      return 0
    }
    const role = generatorRole(command)
    if (role) {
      const target = parseTarget(required(args[0], `${command} requires Feature/Name.`))
      const file = await makeRole(cwd, role, target, args.slice(1))
      io.out(`Created ${path.relative(cwd, file)}`)
      return 0
    }
    if (await runApplicationCommand(command, args, cwd)) return 0
    throw new ArborCommandError(`Unknown Arbor or application command: ${command}`)
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

async function withDatabase<Output>(cwd: string, args: readonly string[], work: (pool: Pool) => Promise<Output>): Promise<Output> {
  const connectionString = await databaseConnection(cwd, args)
  const pool = new Pool({ connectionString, application_name: 'canopy-arbor' })
  try { return await work(pool) } finally { await pool.end() }
}

async function databaseConnection(cwd: string, args: readonly string[]): Promise<string> {
  const explicit = args.find((argument) => argument.startsWith('--database='))?.slice(11)
  const connectionString = explicit || process.env.DATABASE_CONNECTION_STRING || await dotenvValue(cwd, 'DATABASE_CONNECTION_STRING')
  if (!connectionString) throw new ArborCommandError('DATABASE_CONNECTION_STRING is required through the environment, .env, or --database=.')
  return connectionString
}

async function runDatabaseStudio(
  cwd: string,
  args: readonly string[],
  io: ArborIo,
): Promise<number> {
  for (const argument of args) {
    if (argument === '--verbose' || argument.startsWith('--database=')
      || argument.startsWith('--host=') || argument.startsWith('--port=')) continue
    throw new ArborCommandError(`Unknown db:studio option ${argument}.`)
  }
  const connectionString = await databaseConnection(cwd, args)
  const host = option(args, 'host') ?? '127.0.0.1'
  if (host.trim().length === 0) throw new ArborCommandError('--host must not be empty.')
  const port = integerOption(args, 'port', 4_983)
  const artifactsDirectory = path.join(cwd, '.canopy')
  const configPath = path.join(artifactsDirectory, 'drizzle-studio.config.mjs')
  await mkdir(artifactsDirectory, { recursive: true })
  await writeFile(configPath, [
    '// Generated by Canopy Arbor. Do not edit.',
    'export default {',
    "  dialect: 'postgresql',",
    '  dbCredentials: { url: process.env.DATABASE_CONNECTION_STRING },',
    '}',
    '',
  ].join('\n'), 'utf8')

  const drizzleKit = path.join(
    path.dirname(fileURLToPath(import.meta.resolve('drizzle-kit'))),
    'bin.cjs',
  )
  const drizzleArguments = [
    drizzleKit,
    'studio',
    `--config=${configPath}`,
    `--host=${host}`,
    `--port=${port}`,
    ...(args.includes('--verbose') ? ['--verbose'] : []),
  ]
  const environment = {
    ...await dotenvEnvironment(cwd),
    ...process.env,
    DATABASE_CONNECTION_STRING: connectionString,
  }
  io.out(`Starting Drizzle Studio for Canopy (proxy ${host}:${port}).`)
  return await (io.run ?? runProcess)(process.execPath, drizzleArguments, cwd, environment)
}

async function runUndergrowth(cwd: string, args: readonly string[], io: ArborIo): Promise<void> {
  for (const argument of args) {
    if (argument.startsWith('--database=') || argument.startsWith('--host=') || argument.startsWith('--port=')) continue
    throw new ArborCommandError(`Unknown undergrowth option ${argument}.`)
  }
  const host = option(args, 'host') ?? '127.0.0.1'
  const port = integerOption(args, 'port', 4_400)
  const service = await listenUndergrowth({ connectionString: await databaseConnection(cwd, args), host, port })
  io.out(`Undergrowth is revealing ${service.url.toString()}`)
  await new Promise<void>((resolve) => {
    let stopping = false
    const stop = () => {
      if (stopping) return
      stopping = true
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      void service.shutdown().finally(resolve)
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}

async function addUndergrowth(cwd: string): Promise<void> {
  const packagePath = path.join(cwd, 'package.json')
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
    dependencies?: Record<string, string>
    scripts?: Record<string, string>
  }
  packageJson.dependencies ??= {}
  packageJson.dependencies['@canopy/undergrowth'] = packageJson.dependencies['@canopy/core'] ?? '^0.1.0'
  packageJson.scripts ??= {}
  packageJson.scripts.undergrowth = 'arbor undergrowth'
  packageJson.scripts['undergrowth:prune'] = 'arbor undergrowth:prune'
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')

  const providerPath = path.join(cwd, 'src/infrastructure/undergrowth.ts')
  await mkdir(path.dirname(providerPath), { recursive: true })
  if (!await fileExists(providerPath)) {
    await writeFile(providerPath, `import { PostgresUndergrowth } from '@canopy/undergrowth'\nimport { DatabaseConfig } from './database.config.js'\n\nexport class ApplicationUndergrowth extends PostgresUndergrowth {\n  static override readonly id = 'undergrowth'\n  constructor(config: DatabaseConfig) {\n    super({ connectionString: config.connectionString.reveal() })\n  }\n}\n`, 'utf8')
  }
  const featurePath = path.join(cwd, 'src/infrastructure/infrastructure.feature.ts')
  let feature: string
  try { feature = await readFile(featurePath, 'utf8') }
  catch { throw new ArborCommandError('Undergrowth expects src/infrastructure/infrastructure.feature.ts. Generate an Infrastructure Feature first.') }
  if (!feature.includes("from './undergrowth.js'")) {
    const importLine = "import { ApplicationUndergrowth } from './undergrowth.js'\n"
    const lastImport = [...feature.matchAll(/^import .*$/gm)].at(-1)
    const insertAt = lastImport ? lastImport.index! + lastImport[0].length + 1 : 0
    feature = feature.slice(0, insertAt) + importLine + feature.slice(insertAt)
  }
  if (!/providers\s*=\s*\[[^\]]*ApplicationUndergrowth/s.test(feature)) {
    feature = feature.replace(/providers\s*=\s*\[([^\]]*)\]/s, (_match, providers: string) => `providers = [${providers.trim()}${providers.trim() ? ', ' : ''}ApplicationUndergrowth]`)
  }
  if (!feature.includes('ApplicationUndergrowth]')) throw new ArborCommandError('Could not add Undergrowth to the Infrastructure Feature providers array.')
  await writeFile(featurePath, feature, 'utf8')
}

async function redriveDelivery(pool: Pool, id: string): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const found = await client.query<{ channel: 'mail' | 'sms'; state: string; payload: unknown; context: Record<string, unknown> }>(`
      SELECT channel, state, payload, context FROM canopy_delivery_messages WHERE id = $1 FOR UPDATE
    `, [id])
    const delivery = found.rows[0]
    if (!delivery) throw new ArborCommandError(`Delivery ${id} was not found.`)
    if (!['failed', 'undelivered'].includes(delivery.state)) throw new ArborCommandError(`Delivery ${id} is ${delivery.state}; only failed or undelivered deliveries may be retried.`)
    const outboxId = randomUUID()
    const envelopeId = randomUUID()
    const context = delivery.context
    const { executionId, ...durableContext } = context
    const queueContext = {
      ...durableContext,
      sourceExecutionId: executionId,
      causationId: id,
    }
    await client.query(`
      UPDATE canopy_delivery_messages
      SET state = 'pending', failure_kind = NULL, failure_code = NULL, updated_at = now()
      WHERE id = $1
    `, [id])
    await client.query(`
      INSERT INTO canopy_outbox_messages (id, message_type, payload, context, status, available_at, created_at)
      VALUES ($1, 'canopy.queue', $2::jsonb, $3::jsonb, 'pending', now(), now())
    `, [outboxId, JSON.stringify({
      id: envelopeId,
      kind: delivery.channel,
      targetId: `canopy:${delivery.channel}`,
      payload: delivery.payload,
      context: queueContext,
      policy: { retries: 3, retryDelay: 1, backoff: true, timeout: 30 },
    }), JSON.stringify(context)])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
}

async function listAuth(
  pool: Pool,
  command: 'auth:identities' | 'auth:sessions' | 'auth:tokens',
  identityId: string | undefined,
  io: ArborIo,
): Promise<void> {
  if (command === 'auth:identities') {
    const result = await pool.query<{ id: string; email: string; email_verified_at: Date | null; created_at: Date }>(`
      SELECT id, email, email_verified_at, created_at FROM canopy_auth_identities ORDER BY created_at DESC LIMIT 100
    `)
    for (const row of result.rows) io.out(`${row.id} ${row.email} verified=${row.email_verified_at ? 'yes' : 'no'} created=${row.created_at.toISOString()}`)
    return
  }
  if (command === 'auth:sessions') {
    const result = await pool.query<{ id: string; identity_id: string; last_seen_at: Date; expires_at: Date; revoked_at: Date | null }>(`
      SELECT id, identity_id, last_seen_at, expires_at, revoked_at FROM canopy_auth_sessions
      WHERE ($1::text IS NULL OR identity_id = $1) ORDER BY created_at DESC LIMIT 100
    `, [identityId ?? null])
    for (const row of result.rows) io.out(`${row.id} identity=${row.identity_id} ${row.revoked_at ? 'revoked' : 'active'} last=${row.last_seen_at.toISOString()} expires=${row.expires_at.toISOString()}`)
    return
  }
  const result = await pool.query<{ id: string; identity_id: string; name: string; display_prefix: string; expires_at: Date; revoked_at: Date | null }>(`
    SELECT id, identity_id, name, display_prefix, expires_at, revoked_at FROM canopy_auth_access_tokens
    WHERE ($1::text IS NULL OR identity_id = $1) ORDER BY created_at DESC LIMIT 100
  `, [identityId ?? null])
  for (const row of result.rows) io.out(`${row.id} identity=${row.identity_id} ${row.revoked_at ? 'revoked' : 'active'} ${row.name} prefix=${row.display_prefix} expires=${row.expires_at.toISOString()}`)
}

async function revokeAuth(
  pool: Pool,
  command: 'auth:revoke-session' | 'auth:revoke-token',
  id: string,
): Promise<void> {
  const session = command === 'auth:revoke-session'
  const table = session ? 'canopy_auth_sessions' : 'canopy_auth_access_tokens'
  const result = await pool.query<{ identity_id: string }>(`
    UPDATE ${table} SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING identity_id
  `, [id])
  const row = result.rows[0]
  if (!row) throw new ArborCommandError(`${session ? 'Session' : 'Access token'} ${id} is unavailable or already revoked.`)
  await pool.query(`
    INSERT INTO canopy_auth_audit_events (id, event_type, identity_id, ${session ? 'session_id,' : ''} metadata, occurred_at)
    VALUES ($1, $2, $3, ${session ? '$4,' : ''} $${session ? 5 : 4}::jsonb, now())
  `, session
    ? [randomUUID(), 'session.revoked_by_operator', row.identity_id, id, JSON.stringify({})]
    : [randomUUID(), 'access_token.revoked_by_operator', row.identity_id, JSON.stringify({ tokenId: id })])
}

async function listInfrastructure(
  pool: Pool,
  command: 'journal:list' | 'outbox:list' | 'cache:list',
  io: ArborIo,
): Promise<void> {
  if (command === 'journal:list') {
    const result = await pool.query<{ id: string; fact_type: string; entity_type: string; entity_id: string; occurred_at: Date }>(`
      SELECT id, fact_type, entity_type, entity_id, occurred_at FROM canopy_journal_entries ORDER BY occurred_at DESC LIMIT 100
    `)
    for (const row of result.rows) io.out(`${row.occurred_at.toISOString()} ${row.fact_type} ${row.entity_type}/${row.entity_id} ${row.id}`)
    return
  }
  if (command === 'outbox:list') {
    const result = await pool.query<{ id: string; message_type: string; status: string; available_at: Date }>(`
      SELECT id, message_type, status, available_at FROM canopy_outbox_messages ORDER BY created_at DESC LIMIT 100
    `)
    for (const row of result.rows) io.out(`${row.status.padEnd(10)} ${row.message_type} ${row.id} available=${row.available_at.toISOString()}`)
    return
  }
  const result = await pool.query<{ key: string; expires_at: Date | null }>(`
    SELECT key, expires_at FROM canopy_cache_entries WHERE expires_at IS NULL OR expires_at > now() ORDER BY key LIMIT 100
  `)
  for (const row of result.rows) io.out(`${row.key} expires=${row.expires_at?.toISOString() ?? 'never'}`)
}

async function operateSchedule(
  command: 'schedule:status' | 'schedule:enable' | 'schedule:disable' | 'schedule:run',
  cwd: string,
  args: readonly string[],
  io: ArborIo,
): Promise<void> {
  const result = await buildApplication(cwd)
  const schedules = result.manifest.schedules
  const requested = command === 'schedule:status' ? undefined : required(args[0], `${command} requires a schedule ID.`)
  const schedule = requested ? schedules.find((entry) => entry.id === requested || entry.id.endsWith(`/${requested}`)) : undefined
  if (requested && !schedule) throw new ArborCommandError(`Schedule ${requested} is not declared.`)
  await withDatabase(cwd, requested ? args.slice(1) : args, async (pool) => {
    for (const entry of schedules) await pool.query(`INSERT INTO canopy_schedule_controls (schedule_id, enabled) VALUES ($1, true) ON CONFLICT (schedule_id) DO NOTHING`, [entry.id])
    if (command === 'schedule:status') {
      const controls = await pool.query<{ schedule_id: string; enabled: boolean }>('SELECT schedule_id, enabled FROM canopy_schedule_controls')
      const enabled = new Map(controls.rows.map((row) => [row.schedule_id, row.enabled]))
      for (const entry of schedules) io.out(`${enabled.get(entry.id) === false ? 'disabled' : 'enabled '} ${entry.id} -> ${entry.jobId} ${JSON.stringify(entry.cadence)}`)
      return
    }
    if (command === 'schedule:enable' || command === 'schedule:disable') {
      const value = command === 'schedule:enable'
      await pool.query('UPDATE canopy_schedule_controls SET enabled = $2, updated_at = now() WHERE schedule_id = $1', [schedule!.id, value])
      io.out(`${value ? 'Enabled' : 'Disabled'} schedule ${schedule!.id}. Restart the scheduler role to reconcile immediately.`)
      return
    }
    const job = result.manifest.jobs.find((entry) => entry.id === schedule!.jobId)
    if (!job) throw new ArborCommandError(`Schedule ${schedule!.id} targets a missing job.`)
    const envelopeId = randomUUID()
    const context: QueueEnvelope['context'] = {
      sourceExecutionId: envelopeId,
      correlationId: envelopeId,
      causationId: schedule!.id,
      actor: { kind: 'system', id: 'canopy:arbor' },
      initiator: { kind: 'system', id: 'canopy:arbor' },
      delegation: [],
      authentication: { state: 'authenticated', identityId: 'canopy:arbor', method: 'console' },
      trace: {},
      timeZone: schedule!.timeZone,
    }
    const envelope: QueueEnvelope = {
      id: envelopeId,
      kind: 'job',
      targetId: schedule!.jobId,
      scheduleId: schedule!.id,
      payload: schedule!.input as import('@canopy/core').JsonValue,
      context,
      policy: { retries: job.retries, retryDelay: job.retryDelay, backoff: job.backoff, timeout: job.timeout },
    }
    await pool.query(`
      INSERT INTO canopy_outbox_messages (id, message_type, payload, context, status, available_at, created_at)
      VALUES ($1, 'canopy.queue', $2::jsonb, $3::jsonb, 'pending', now(), now())
    `, [randomUUID(), JSON.stringify(envelope), JSON.stringify(context)])
    io.out(`Fired schedule ${schedule!.id} as queue job ${envelopeId}.`)
  })
}

async function dotenvValue(cwd: string, key: string): Promise<string | undefined> {
  let content: string
  try { content = await readFile(path.join(cwd, '.env'), 'utf8') } catch { return undefined }
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match || match[1] !== key) continue
    const value = match[2]!
    return ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) ? value.slice(1, -1) : value
  }
  return undefined
}

interface MigrationFile { readonly id: string; readonly sql: string; readonly checksum: string }

async function discoverMigrations(cwd: string): Promise<readonly MigrationFile[]> {
  const framework = ['postgres-drizzle', 'auth-postgres', 'queue-pg-boss']
  if (await packageDeclares(cwd, '@canopy/undergrowth')) framework.push('undergrowth')
  const roots: Array<{ prefix: string; directory: string }> = []
  for (const name of framework) {
    const installed = path.join(cwd, 'node_modules', '@canopy', name, 'migrations')
    const workspace = path.resolve(import.meta.dirname, '..', '..', name, 'migrations')
    roots.push({ prefix: `framework/${name}`, directory: await directoryExists(installed) ? installed : workspace })
  }
  roots.push({ prefix: 'application', directory: path.join(cwd, 'migrations') })
  const migrations: MigrationFile[] = []
  for (const root of roots) {
    let names: string[]
    try { names = (await readdir(root.directory)).filter((name) => name.endsWith('.sql')).sort() }
    catch { continue }
    for (const name of names) {
      const sql = await readFile(path.join(root.directory, name), 'utf8')
      migrations.push({
        id: `${root.prefix}/${name}`,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      })
    }
  }
  return migrations
}

async function packageDeclares(cwd: string, dependency: string): Promise<boolean> {
  try {
    const packageJson = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>; devDependencies?: Record<string, string>
    }
    return dependency in (packageJson.dependencies ?? {}) || dependency in (packageJson.devDependencies ?? {})
  } catch { return false }
}

async function applyMigrations(pool: Pool, migrations: readonly MigrationFile[]): Promise<readonly string[]> {
  const client = await pool.connect()
  const applied: string[] = []
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS canopy_migrations (
        id text PRIMARY KEY,
        checksum text NOT NULL,
        batch integer NOT NULL,
        applied_at timestamptz NOT NULL
      )
    `)
    await client.query(`SELECT pg_advisory_lock(hashtext('canopy:migrations'))`)
    const existing = await client.query<{ id: string; checksum: string }>('SELECT id, checksum FROM canopy_migrations')
    const byId = new Map(existing.rows.map((row) => [row.id, row.checksum]))
    for (const migration of migrations) {
      const checksum = byId.get(migration.id)
      if (checksum && checksum !== migration.checksum) throw new ArborCommandError(`Applied migration ${migration.id} has changed; create a new migration instead.`)
    }
    const batchResult = await client.query<{ batch: number }>('SELECT COALESCE(max(batch), 0) + 1 AS batch FROM canopy_migrations')
    const batch = batchResult.rows[0]!.batch
    for (const migration of migrations) {
      if (byId.has(migration.id)) continue
      await client.query('BEGIN')
      try {
        await client.query(migration.sql)
        await client.query('INSERT INTO canopy_migrations (id, checksum, batch, applied_at) VALUES ($1, $2, $3, now())', [migration.id, migration.checksum, batch])
        await client.query('COMMIT')
        applied.push(migration.id)
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      }
    }
    return applied
  } finally {
    await client.query(`SELECT pg_advisory_unlock(hashtext('canopy:migrations'))`).catch(() => undefined)
    client.release()
  }
}

async function migrationStatus(pool: Pool, migrations: readonly MigrationFile[]): Promise<readonly { id: string; state: 'applied' | 'pending' | 'drifted' }[]> {
  const exists = await pool.query<{ exists: boolean }>(`SELECT to_regclass('public.canopy_migrations') IS NOT NULL AS exists`)
  const rows = exists.rows[0]?.exists
    ? await pool.query<{ id: string; checksum: string }>('SELECT id, checksum FROM canopy_migrations')
    : { rows: [] as Array<{ id: string; checksum: string }> }
  const applied = new Map(rows.rows.map((row) => [row.id, row.checksum]))
  return migrations.map((migration) => ({
    id: migration.id,
    state: !applied.has(migration.id) ? 'pending'
      : applied.get(migration.id) === migration.checksum ? 'applied' : 'drifted',
  }))
}

async function directoryExists(directory: string): Promise<boolean> {
  try { await readdir(directory); return true } catch { return false }
}

async function compile(cwd: string) {
  return compileApplication({
    tsconfigPath: path.join(cwd, 'tsconfig.json'),
    applicationFile: path.join(cwd, 'src/application.ts'),
    sourceRoot: path.join(cwd, 'src'),
    outputRoot: path.join(cwd, 'dist'),
    artifactsDirectory: path.join(cwd, '.canopy'),
  })
}

async function makeApplication(directory: string, rawName: string): Promise<void> {
  const name = pascal(rawName)
  const packageName = kebab(rawName)
  await mkdir(path.join(directory, 'src', 'app', 'http'), { recursive: true })
  const files: Readonly<Record<string, string>> = {
    'package.json': `${JSON.stringify({
      name: packageName,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        arbor: 'arbor',
        build: 'arbor build',
        dev: 'arbor dev',
        serve: 'arbor serve',
        work: 'arbor work',
        schedule: 'arbor schedule',
        migrate: 'arbor migrate',
        'db:studio': 'arbor db:studio',
        test: 'arbor build && vitest run',
      },
      dependencies: {
        '@canopy/arbor': '^0.1.0',
        '@canopy/auth-postgres': '^0.1.0',
        '@canopy/compiler': '^0.1.0',
        '@canopy/core': '^0.1.0',
        '@canopy/http-hono': '^0.1.0',
        '@canopy/postgres-drizzle': '^0.1.0',
        '@canopy/queue-pg-boss': '^0.1.0',
        '@canopy/runtime': '^0.1.0',
      },
      devDependencies: { '@canopy/testing': '^0.1.0', '@types/node': '^24.0.0', typescript: '^6.0.0', vitest: '^4.0.0' },
      engines: { node: '>=24 <25' },
    }, null, 2)}\n`,
    'tsconfig.json': `${JSON.stringify({
      compilerOptions: {
        target: 'ES2024', lib: ['ES2024'], module: 'NodeNext', moduleResolution: 'NodeNext',
        types: ['node'], strict: true, noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true, verbatimModuleSyntax: true,
        skipLibCheck: true,
        rootDir: 'src', outDir: 'dist', sourceMap: true,
      },
      include: ['src/**/*.ts'],
    }, null, 2)}\n`,
    '.gitignore': 'node_modules\ndist\n.canopy\n.env\n',
    '.env.example': 'DATABASE_CONNECTION_STRING=postgresql://canopy:canopy@127.0.0.1:54329/canopy\nPORT=3000\nHOST=127.0.0.1\nCANOPY_LOG_LEVEL=info\n# CANOPY_LOG_FORMAT=pretty\n',
    'compose.yaml': `services:\n  postgres:\n    image: postgres:17-alpine\n    environment:\n      POSTGRES_USER: canopy\n      POSTGRES_PASSWORD: canopy\n      POSTGRES_DB: canopy\n    ports:\n      - "54329:5432"\n    healthcheck:\n      test: ["CMD-SHELL", "pg_isready -U canopy"]\n      interval: 2s\n      timeout: 2s\n      retries: 20\n`,
    'README.md': `# ${name}\n\nGenerated by Canopy Arbor.\n\n\`\`\`sh\npnpm install\ncp .env.example .env\ndocker compose up -d\npnpm migrate\npnpm dev\n\`\`\`\n\n\`pnpm dev\` watches \`src/\`, keeps the last good server alive when a build fails, and hot reloads a fresh runtime after valid changes. Run \`pnpm db:studio\` to browse the configured PostgreSQL database.\n`,
    'src/application.ts': `import { CanopyApplication } from '@canopy/core'\n\nimport { AccountsFeature } from './accounts/accounts.feature.js'\nimport { AppFeature } from './app/app.feature.js'\nimport { InfrastructureFeature } from './infrastructure/infrastructure.feature.js'\nimport { TasksFeature } from './tasks/tasks.feature.js'\n\nexport class Application extends CanopyApplication {\n  id = '${packageName}'\n  features = [InfrastructureFeature, AccountsFeature, TasksFeature, AppFeature]\n}\n`,
    'src/app/app.feature.ts': `import { Feature } from '@canopy/core'\n\nimport { HealthRoute } from './http/health.route.js'\nimport { HomeRoute } from './http/home.route.js'\n\nexport class AppFeature extends Feature {\n  id = 'app'\n  routes = [HomeRoute, HealthRoute]\n}\n`,
    'src/app/http/home.route.ts': `import { type HttpRequest, Route } from '@canopy/core'\n\nexport class HomeRoute extends Route {\n  static override readonly id = 'home'\n  static override readonly access = 'public'\n  readonly method = 'GET'\n  readonly path = '/'\n  handle(_request: HttpRequest) { this.logger.info('Home visited'); return { application: '${packageName}', framework: 'Canopy' } }\n}\n`,
    'src/app/http/health.route.ts': `import { type HttpRequest, Route } from '@canopy/core'\n\nexport class HealthRoute extends Route {\n  static override readonly id = 'health'\n  static override readonly access = 'public'\n  readonly method = 'GET'\n  readonly path = '/health'\n  handle(_request: HttpRequest) { return { status: 'ok' } }\n}\n`,
    'src/infrastructure/database.config.ts': `import { Configuration, SecretString } from '@canopy/core'\n\nexport class DatabaseConfig extends Configuration {\n  declare connectionString: SecretString\n}\n`,
    'src/infrastructure/transactions.ts': `import { PostgresTransactionManager } from '@canopy/postgres-drizzle'\nimport { DatabaseConfig } from './database.config.js'\n\nexport class Transactions extends PostgresTransactionManager {\n  static id = 'transactions'\n  constructor(config: DatabaseConfig) { super({ connectionString: config.connectionString.reveal(), applicationName: '${packageName}' }) }\n}\n`,
    'src/infrastructure/queues.ts': `import { PgBossQueueManager } from '@canopy/queue-pg-boss'\nimport { DatabaseConfig } from './database.config.js'\n\nexport class Queues extends PgBossQueueManager {\n  static id = 'queues'\n  constructor(config: DatabaseConfig) { super({ connectionString: config.connectionString.reveal(), applicationName: '${packageName}' }) }\n}\n`,
    'src/infrastructure/auth.ts': `import { PostgresAuth } from '@canopy/auth-postgres'\nimport { DatabaseConfig } from './database.config.js'\n\nexport class ApplicationAuth extends PostgresAuth {\n  static override readonly id = 'auth'\n  constructor(config: DatabaseConfig) { super({ connectionString: config.connectionString.reveal(), secureCookies: false, trustedOrigins: ['http://127.0.0.1:3000'] }) }\n}\n`,
    'src/infrastructure/cache.ts': `import { PostgresCache } from '@canopy/postgres-drizzle'\nimport { DatabaseConfig } from './database.config.js'\n\nexport class ApplicationCache extends PostgresCache {\n  static id = 'cache'\n  constructor(config: DatabaseConfig) { super({ connectionString: config.connectionString.reveal(), applicationName: '${packageName}-cache' }) }\n}\n`,
    'src/infrastructure/mail.ts': `import { FakeMailTransport } from '@canopy/core'\nexport class ApplicationMail extends FakeMailTransport { static id = 'mail' }\n`,
    'src/infrastructure/sms.ts': `import { FakeSmsTransport } from '@canopy/core'\nexport class ApplicationSms extends FakeSmsTransport { static id = 'sms' }\n`,
    'src/infrastructure/infrastructure.feature.ts': `import { Feature } from '@canopy/core'\nimport { ApplicationAuth } from './auth.js'\nimport { ApplicationCache } from './cache.js'\nimport { DatabaseConfig } from './database.config.js'\nimport { ApplicationMail } from './mail.js'\nimport { Queues } from './queues.js'\nimport { ApplicationSms } from './sms.js'\nimport { Transactions } from './transactions.js'\n\nexport class InfrastructureFeature extends Feature {\n  id = 'infrastructure'\n  configs = [DatabaseConfig]\n  providers = [Transactions, Queues, ApplicationAuth, ApplicationCache, ApplicationMail, ApplicationSms]\n}\n`,
    'src/accounts/credentials.ts': `import { HttpError, type HttpRequest } from '@canopy/core'\n\nexport async function credentials(request: HttpRequest): Promise<{ email: string; password: string }> {\n  const body = await request.json<{ email?: unknown; password?: unknown }>()\n  if (typeof body.email !== 'string' || typeof body.password !== 'string') throw new HttpError(422, 'validation_failed', 'email and password are required')\n  return { email: body.email, password: body.password }\n}\n`,
    'src/accounts/send-auth-email.ts': `import { randomUUID } from 'node:crypto'\nimport { Action, Mailer } from '@canopy/core'\n\nexport class SendAuthEmail extends Action<{ kind: 'verification' | 'password-reset'; to: string; token: string }, void> {\n  static id = 'send-auth-email'\n  static override readonly access = 'public'\n  private readonly mailer = this.inject(Mailer)\n  async handle(input: { kind: 'verification' | 'password-reset'; to: string; token: string }): Promise<void> {\n    await this.mailer.send({ id: randomUUID(), from: 'accounts@${packageName}.test', to: [input.to], subject: input.kind === 'verification' ? 'Verify your email' : 'Reset your password', text: input.token })\n  }\n}\n`,
    'src/accounts/account.policy.ts': `import { allow, deny, Policy, type PolicyDecision, type PolicyRequest } from '@canopy/core'\n\nexport class AccountPolicy extends Policy {\n  static override readonly id = 'account'\n  static override readonly abilities = ['accounts.view-self', 'accounts.tokens.manage']\n  decide(request: PolicyRequest): PolicyDecision {\n    if (request.actor.kind !== 'user' || request.context.authentication.state !== 'authenticated') return deny('account', 'authentication_required')\n    if (request.ability === 'accounts.tokens.manage' && request.context.authentication.method !== 'password') return deny('account', 'password_session_required')\n    return allow('account')\n  }\n}\n`,
    'src/accounts/register.route.ts': `import { ActionBus, Auth, Http, type HttpRequest, Route } from '@canopy/core'\nimport { credentials } from './credentials.js'\nimport { SendAuthEmail } from './send-auth-email.js'\n\nexport class RegisterRoute extends Route {\n  static override readonly id = 'register'; static override readonly access = 'public'\n  readonly method = 'POST'; readonly path = '/auth/register'\n  private readonly auth = this.inject(Auth)\n  private readonly actions = this.inject(ActionBus)\n  async handle(request: HttpRequest): Promise<Response> {\n    const identity = await this.auth.register(await credentials(request))\n    const challenge = await this.auth.issueEmailVerification(identity.id)\n    await this.actions.execute(SendAuthEmail, { kind: 'verification', to: identity.email, token: challenge.token.reveal() })\n    return Http.created({ identity: { id: identity.id, email: identity.email, emailVerified: identity.emailVerified } })\n  }\n}\n`,
    'src/accounts/login.route.ts': `import { Auth, Http, type HttpRequest, Route } from '@canopy/core'\nimport { credentials } from './credentials.js'\n\nexport class LoginRoute extends Route {\n  static override readonly id = 'login'; static override readonly access = 'public'\n  readonly method = 'POST'; readonly path = '/auth/login'\n  private readonly auth = this.inject(Auth)\n  async handle(request: HttpRequest): Promise<Response> {\n    const grant = await this.auth.login(await credentials(request), { userAgent: request.header('user-agent') ?? 'unknown' })\n    return Http.json({ identity: { id: grant.identity.id, email: grant.identity.email, emailVerified: grant.identity.emailVerified } }, 200, { 'set-cookie': this.auth.sessionCookie(grant) })\n  }\n}\n`,
    'src/accounts/me.route.ts': `import { CurrentExecution, type HttpRequest, Route } from '@canopy/core'\n\nexport class MeRoute extends Route {\n  static override readonly id = 'me'; static override readonly access = 'accounts.view-self'\n  readonly method = 'GET'; readonly path = '/auth/me'\n  private readonly execution = this.inject(CurrentExecution)\n  handle(_request: HttpRequest) { return { actor: this.execution.context.actor, authentication: this.execution.context.authentication } }\n}\n`,
    'src/accounts/verify-email.route.ts': `import { Auth, HttpError, type HttpRequest, Route } from '@canopy/core'\n\nexport class VerifyEmailRoute extends Route {\n  static override readonly id = 'verify-email'; static override readonly access = 'public'\n  readonly method = 'POST'; readonly path = '/auth/email/verify'\n  private readonly auth = this.inject(Auth)\n  async handle(request: HttpRequest) {\n    const body = await request.json<{ token?: unknown }>()\n    if (typeof body.token !== 'string') throw new HttpError(422, 'validation_failed', 'token is required')\n    const identity = await this.auth.verifyEmail(body.token)\n    return { identity: { id: identity.id, email: identity.email, emailVerified: identity.emailVerified } }\n  }\n}\n`,
    'src/accounts/token.route.ts': `import { Auth, CurrentExecution, Http, HttpError, type HttpRequest, Route } from '@canopy/core'\n\nexport class TokenRoute extends Route {\n  static override readonly id = 'issue-token'; static override readonly access = 'accounts.tokens.manage'\n  readonly method = 'POST'; readonly path = '/auth/tokens'\n  private readonly auth = this.inject(Auth)\n  private readonly execution = this.inject(CurrentExecution)\n  async handle(request: HttpRequest): Promise<Response> {\n    const identityId = this.execution.context.authentication.identityId\n    if (!identityId) throw new HttpError(401, 'authentication_required', 'Authentication is required.')\n    const body = await request.json<{ name?: unknown; constraints?: unknown }>()\n    if (typeof body.name !== 'string' || (body.constraints !== undefined && (!Array.isArray(body.constraints) || !body.constraints.every((value) => typeof value === 'string')))) throw new HttpError(422, 'validation_failed', 'name and string constraints are required')\n    const grant = await this.auth.issueAccessToken(identityId, { name: body.name, ...(body.constraints ? { constraints: body.constraints as string[] } : {}) })\n    return Http.created({ accessToken: grant.accessToken, token: grant.token.reveal() })\n  }\n}\n`,
    'src/accounts/request-password-reset.route.ts': `import { ActionBus, Auth, type HttpRequest, Route } from '@canopy/core'\nimport { SendAuthEmail } from './send-auth-email.js'\n\nexport class RequestPasswordResetRoute extends Route {\n  static override readonly id = 'request-password-reset'; static override readonly access = 'public'\n  readonly method = 'POST'; readonly path = '/auth/password/reset/request'\n  private readonly auth = this.inject(Auth)\n  private readonly actions = this.inject(ActionBus)\n  async handle(request: HttpRequest): Promise<Response> {\n    const body = await request.json<{ email?: unknown }>()\n    if (typeof body.email === 'string') { const challenge = await this.auth.issuePasswordReset(body.email); if (challenge) await this.actions.execute(SendAuthEmail, { kind: 'password-reset', to: body.email, token: challenge.token.reveal() }) }\n    return new Response(null, { status: 204 })\n  }\n}\n`,
    'src/accounts/reset-password.route.ts': `import { Auth, HttpError, type HttpRequest, Route } from '@canopy/core'\n\nexport class ResetPasswordRoute extends Route {\n  static override readonly id = 'reset-password'; static override readonly access = 'public'\n  readonly method = 'POST'; readonly path = '/auth/password/reset'\n  private readonly auth = this.inject(Auth)\n  async handle(request: HttpRequest): Promise<Response> {\n    const body = await request.json<{ token?: unknown; password?: unknown }>()\n    if (typeof body.token !== 'string' || typeof body.password !== 'string') throw new HttpError(422, 'validation_failed', 'token and password are required')\n    await this.auth.resetPassword(body.token, body.password); return new Response(null, { status: 204 })\n  }\n}\n`,
    'src/accounts/accounts.feature.ts': `import { Feature } from '@canopy/core'\nimport { AccountPolicy } from './account.policy.js'\nimport { LoginRoute } from './login.route.js'\nimport { MeRoute } from './me.route.js'\nimport { RegisterRoute } from './register.route.js'\nimport { RequestPasswordResetRoute } from './request-password-reset.route.js'\nimport { ResetPasswordRoute } from './reset-password.route.js'\nimport { SendAuthEmail } from './send-auth-email.js'\nimport { TokenRoute } from './token.route.js'\nimport { VerifyEmailRoute } from './verify-email.route.js'\n\nexport class AccountsFeature extends Feature {\n  id = 'accounts'\n  actions = [SendAuthEmail]\n  routes = [RegisterRoute, LoginRoute, MeRoute, VerifyEmailRoute, TokenRoute, RequestPasswordResetRoute, ResetPasswordRoute]\n  policies = [AccountPolicy]\n}\n`,
    'src/tasks/task.ts': `import { Model, type ModelAttributes } from '@canopy/core'\n\nexport interface TaskAttributes extends ModelAttributes { id: string; ownerId: string; title: string; completed: boolean }\n\nexport class Task extends Model<TaskAttributes> {\n  static override readonly id = 'task'\n  get ownerId(): string { return this.attributes.ownerId }\n  get completed(): boolean { return this.attributes.completed }\n  complete(): void {\n    if (this.attributes.completed) return\n    this.attributes.completed = true\n    this.journal('task.completed', { title: this.attributes.title })\n    this.outbox('task.completed', { taskId: this.id, ownerId: this.ownerId })\n  }\n}\n`,
    'src/tasks/task.policy.ts': `import { allow, deny, Policy, type PolicyDecision, type PolicyRequest } from '@canopy/core'\n\nexport class TaskPolicy extends Policy<{ ownerId: string }> {\n  static override readonly id = 'task'\n  static override readonly abilities = ['tasks.update']\n  decide(request: PolicyRequest<{ ownerId: string }>): PolicyDecision {\n    if (request.actor.kind !== 'user' || !request.actor.id) return deny('task', 'authentication_required')\n    if (request.resource && request.resource.ownerId !== request.actor.id) return deny('task', 'owner_required')\n    return allow('task')\n  }\n}\n`,
    'src/tasks/task-completed.event.ts': `import { Event } from '@canopy/core'\n\nexport class TaskCompleted extends Event<{ taskId: string; ownerId: string }> {\n  static override readonly id = 'task-completed'\n}\n`,
    'src/tasks/task-touched.signal.ts': `import { Signal } from '@canopy/core'\n\nexport class TaskTouched extends Signal<{ taskId: string }> {\n  static override readonly id = 'task-touched'\n}\n`,
    'src/tasks/record-task-touched.ts': `import { SignalHandler } from '@canopy/core'\nimport { TaskTouched } from './task-touched.signal.js'\n\nexport class RecordTaskTouched extends SignalHandler<TaskTouched> {\n  static id = 'record-task-touched'; static override readonly access = 'public'\n  handle(_signal: TaskTouched): void {}\n}\n`,
    'src/tasks/task.observer.ts': `import { Observer } from '@canopy/core'\nimport { Task } from './task.js'\n\nexport class TaskObserver extends Observer<Task> {\n  static id = 'task'\n  saving(_task: Task): void {}\n  committed(_task: Task): void {}\n}\n`,
    'src/tasks/record-task-completed.ts': `import { Listener } from '@canopy/core'\nimport { TaskCompleted } from './task-completed.event.js'\n\nexport class RecordTaskCompleted extends Listener<TaskCompleted> {\n  static id = 'record-task-completed'; static override readonly access = 'public'\n  handle(_event: TaskCompleted): void {}\n}\n`,
    'src/tasks/queue-task-completed.ts': `import { Listener, type ShouldQueueAfterCommit } from '@canopy/core'\nimport { TaskCompleted } from './task-completed.event.js'\n\nexport class QueueTaskCompleted extends Listener<TaskCompleted> implements ShouldQueueAfterCommit {\n  static id = 'queue-task-completed'; static override readonly access = 'public'\n  handle(_event: TaskCompleted): void {}\n}\n`,
    'src/tasks/process-task.job.ts': `import { Job } from '@canopy/core'\n\nexport class ProcessTask extends Job<{ taskId: string }> {\n  static override readonly id = 'process-task'; static override readonly access = 'public'\n  async handle(_input: { taskId: string }): Promise<void> {}\n}\n`,
    'src/tasks/process-tasks.schedule.ts': `import { Schedule } from '@canopy/core'\nimport { ProcessTask } from './process-task.job.js'\n\nexport class ProcessTasks extends Schedule<{ taskId: string }> {\n  static override readonly id = 'process-tasks'; static override readonly access = 'public'\n  static override readonly job = ProcessTask\n  static override readonly everySeconds = 3600\n  static override readonly input = { taskId: 'scheduled-maintenance' }\n}\n`,
    'src/tasks/complete-task.ts': `import { randomUUID } from 'node:crypto'\nimport { Action, Authorization, CurrentExecution, Mailer, Sms } from '@canopy/core'\nimport { ProcessTask } from './process-task.job.js'\nimport { Task } from './task.js'\nimport { TaskCompleted } from './task-completed.event.js'\nimport { TaskTouched } from './task-touched.signal.js'\n\nexport class CompleteTask extends Action<{ id: string }, { id: string; completed: boolean; jobId: string }> {\n  static id = 'complete-task'; static override readonly access = 'tasks.update'\n  private readonly authorization = this.inject(Authorization)\n  private readonly execution = this.inject(CurrentExecution)\n  private readonly mailer = this.inject(Mailer)\n  private readonly sms = this.inject(Sms)\n  async handle(input: { id: string }): Promise<{ id: string; completed: boolean; jobId: string }> {\n    const ownerId = this.execution.context.actor.id!\n    const task = await Task.find(input.id) ?? Task.make({ id: input.id, ownerId, title: 'Generated Canopy task', completed: false })\n    await this.authorization.authorize('tasks.update', { ownerId: task.ownerId })\n    task.complete()\n    await TaskTouched.dispatch({ taskId: task.id })\n    await TaskCompleted.dispatch({ taskId: task.id, ownerId: task.ownerId })\n    const jobId = await ProcessTask.dispatch({ taskId: task.id }, { idempotencyKey: 'task:' + task.id })\n    await this.mailer.send({ id: randomUUID(), from: 'tasks@${packageName}.test', to: [ownerId + '@${packageName}.test'], subject: 'Task completed', text: task.id })\n    await this.sms.send({ id: randomUUID(), to: '+15555550123', text: 'Task ' + task.id + ' completed' })\n    await task.save()\n    return { id: task.id, completed: task.completed, jobId }\n  }\n}\n`,
    'src/tasks/complete-task.route.ts': `import { ActionBus, type HttpRequest, Route } from '@canopy/core'\nimport { CompleteTask } from './complete-task.js'\n\nexport class CompleteTaskRoute extends Route {\n  static override readonly id = 'complete-task'; static override readonly access = 'tasks.update'\n  readonly method = 'POST'; readonly path = '/tasks/:id/complete'\n  private readonly actions = this.inject(ActionBus)\n  async handle(request: HttpRequest) { return await this.actions.execute(CompleteTask, { id: request.param('id') }) }\n}\n`,
    'src/tasks/tasks.feature.ts': `import { Feature } from '@canopy/core'\nimport { CompleteTask } from './complete-task.js'\nimport { CompleteTaskRoute } from './complete-task.route.js'\nimport { ProcessTask } from './process-task.job.js'\nimport { ProcessTasks } from './process-tasks.schedule.js'\nimport { QueueTaskCompleted } from './queue-task-completed.js'\nimport { RecordTaskCompleted } from './record-task-completed.js'\nimport { RecordTaskTouched } from './record-task-touched.js'\nimport { Task } from './task.js'\nimport { TaskCompleted } from './task-completed.event.js'\nimport { TaskObserver } from './task.observer.js'\nimport { TaskPolicy } from './task.policy.js'\nimport { TaskTouched } from './task-touched.signal.js'\n\nexport class TasksFeature extends Feature {\n  id = 'tasks'\n  models = [Task]\n  observers = [TaskObserver]\n  actions = [CompleteTask]\n  routes = [CompleteTaskRoute]\n  policies = [TaskPolicy]\n  events = [TaskCompleted]\n  listeners = [RecordTaskCompleted, QueueTaskCompleted]\n  signals = [TaskTouched]\n  signalHandlers = [RecordTaskTouched]\n  jobs = [ProcessTask]\n  schedules = [ProcessTasks]\n}\n`,
    'tests/app.test.ts': `import { describe, expect, it } from 'vitest'\n\ndescribe('${name}', () => {\n  it('is ready to cultivate', () => expect(true).toBe(true))\n})\n`,
  }
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(directory, relative)
    await mkdir(path.dirname(file), { recursive: true })
    await writeNew(file, content)
  }
}

async function buildApplication(cwd: string) {
  const code = await runProcess(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], cwd)
  if (code !== 0) throw new ArborCommandError(`TypeScript build failed with exit code ${code}.`)
  const result = await compile(cwd)
  await writeCultivateKnowledge(cwd, result.manifest as unknown as Record<string, unknown>)
  return result
}

async function writeCultivateKnowledge(cwd: string, manifest: Record<string, unknown>): Promise<void> {
  const roles = ['features', 'configurations', 'providers', 'models', 'observers', 'actions', 'queries', 'routes', 'events', 'listeners', 'signals', 'signalHandlers', 'jobs', 'schedules', 'policies', 'commands']
  const providers = manifest.providers as Array<{ capabilities?: readonly string[] }> | undefined
  const hasUndergrowth = providers?.some((provider) => provider.capabilities?.includes('observations')) ?? false
  const knowledge = {
    schemaVersion: 1,
    framework: 'Canopy',
    applicationId: manifest.applicationId,
    buildHash: manifest.buildHash,
    principles: [
      'Opinionated and magical where safety permits.',
      'Prefer the better developer experience between equally viable choices.',
      'Folder names have no runtime meaning.',
      'Framework roles are explicitly declared by Features and compiled before boot.',
      'Entry points fail closed unless public or owned by a declared policy ability.',
      'Constructors are side-effect free; lifecycle owns I/O and background behavior.',
    ],
    conventions: {
      files: 'kebab-case',
      classes: 'PascalCase',
      featureRegistration: 'role arrays',
      concreteDependencies: 'constructor autowiring',
      applicationCommands: 'arbor <colon-delimited-name>',
      developmentReload: 'compile a new graph and replace the runtime in a fresh process',
      httpResponses: 'return payloads; Canopy owns the success and failure envelope',
    },
    safeMutations: {
      createRole: 'Use arbor make:* so the Feature declaration remains explicit.',
      migrations: 'Create a new forward migration; never edit an applied migration.',
      authorization: 'Choose --public or --ability explicitly for every generated entry role.',
    },
    roles: Object.fromEntries(roles.map((role) => [role, manifest[role] ?? []])),
    undergrowth: {
      installed: hasUndergrowth,
      purpose: 'Read-only correlation and causation debugger for framework executions.',
      observationKinds: ['execution', 'http', 'action', 'query', 'transaction', 'model', 'event', 'listener', 'signal', 'job', 'schedule', 'authorization', 'cache', 'mail', 'sms', 'log', 'exception'],
      safety: ['recursive secret redaction', 'bounded PostgreSQL retention', 'loopback-only host', 'recording failure isolation'],
    },
    arbor: {
      generate: ['new', 'make:feature', 'make:config', 'make:provider', 'make:service', 'make:model', 'make:observer', 'make:action', 'make:query', 'make:route', 'make:policy', 'make:event', 'make:listener', 'make:signal', 'make:signal-handler', 'make:job', 'make:schedule', 'make:command', 'make:migration', 'make:test'],
      runtime: ['dev', 'serve', 'work', 'schedule'],
      operations: ['migrate', 'migrate:status', 'db:studio', 'queue:list', 'queue:failed', 'queue:retry', 'queue:cancel', 'delivery:list', 'delivery:retry'],
      developmentDebugger: ['add undergrowth', 'undergrowth', 'undergrowth:prune'],
      inspect: ['graph', 'route:list', 'model:list', 'auth:storage', 'event:list', 'listener:list', 'observer:list', 'job:list', 'schedule:list', 'policy:list', 'command:list'],
    },
  }
  await mkdir(path.join(cwd, '.canopy'), { recursive: true })
  await writeFile(path.join(cwd, '.canopy/cultivate.json'), `${JSON.stringify(knowledge, null, 2)}\n`, 'utf8')
}

async function runRuntimeCommand(
  command: 'serve' | 'work' | 'schedule' | 'dev',
  cwd: string,
  args: readonly string[],
  io: ArborIo,
): Promise<void> {
  if (command === 'dev') {
    await runHotDevelopment(cwd, args, io)
    return
  }
  const result = await buildApplication(cwd)
  const applicationModule = await import(pathToFileURL(path.join(cwd, 'dist/application.js')).href) as { Application?: Parameters<typeof Canopy.boot>[0] }
  if (!applicationModule.Application) throw new ArborCommandError('dist/application.js must export Application.')
  const environment = { ...await dotenvEnvironment(cwd), ...process.env }
  const worker = command === 'work'
  const scheduler = command === 'schedule'
  const runtime = await Canopy.boot(applicationModule.Application, {
    artifactsDirectory: path.join(cwd, '.canopy'),
    dotenvPath: false,
    environment,
    roles: { worker, scheduler },
    logging: loggingOptions(environment),
  })
  let host: HonoHttpHost | undefined
  if (command === 'serve') {
    const port = integerOption(args, 'port', Number(environment.PORT ?? 3000))
    const hostname = option(args, 'host') ?? environment.HOST ?? '127.0.0.1'
    host = await HonoHttpHost.listen(runtime, { port, hostname })
    io.out(`Canopy ${command} ready at ${host.url}`)
  } else {
    io.out(`Canopy ${command} role ready.`)
  }
  await waitForShutdown(async () => {
    if (host) await host.shutdown()
    else await runtime.shutdown()
  })
}

async function runHotDevelopment(cwd: string, args: readonly string[], io: ArborIo): Promise<void> {
  await withDatabase(cwd, args, async (pool) => {
    await applyMigrations(pool, await discoverMigrations(cwd))
  })
  const supervisor = await HotReloadSupervisor.start({
    watchPaths: [path.join(cwd, 'src')],
    build: () => buildApplication(cwd).then(() => undefined),
    start: () => startDevelopmentChild(cwd, args),
    onWatching: () => io.out('Canopy dev is watching src/ for changes.'),
    onReloaded: () => io.out('Canopy hot reload complete.'),
    onError: (error, phase) => io.error(phase === 'build'
      ? `Canopy hot reload build failed; the last good server remains active. ${errorMessage(error)}`
      : `Canopy hot reload ${phase} failed. ${errorMessage(error)}`),
  })
  await waitForShutdown(() => supervisor.stop())
}

async function startDevelopmentChild(cwd: string, args: readonly string[]): Promise<HotReloadTarget> {
  const child = fork(path.join(import.meta.dirname, 'dev-child.js'), [cwd, JSON.stringify(args)], {
    cwd,
    env: process.env,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  })
  await waitForChildReady(child)
  return {
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return
      const exited = waitForChildExit(child)
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 15_000)
      timer.unref()
      try { await exited } finally { clearTimeout(timer) }
    },
  }
}

function waitForChildReady(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('Development runtime did not become ready within 30 seconds.')), 30_000)
    timeout.unref()
    const onMessage = (message: unknown) => {
      if (typeof message === 'object' && message !== null && 'type' in message
        && (message as { type?: unknown }).type === 'ready') finish()
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(new Error(`Development runtime exited before readiness (${code ?? signal ?? 'unknown'}).`))
    }
    const onError = (error: Error) => finish(error)
    const finish = (error?: Error) => {
      clearTimeout(timeout)
      child.off('message', onMessage)
      child.off('exit', onExit)
      child.off('error', onError)
      if (error) reject(error)
      else resolve()
    }
    child.on('message', onMessage)
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

function waitForChildExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => child.once('exit', () => resolve()))
}

export async function runDevelopmentRuntime(cwd: string, args: readonly string[]): Promise<void> {
  const manifest = JSON.parse(await readFile(path.join(cwd, '.canopy/manifest.json'), 'utf8')) as { buildHash: string }
  const applicationModule = await import(
    `${pathToFileURL(path.join(cwd, 'dist/application.js')).href}?buildHash=${manifest.buildHash}`
  ) as { Application?: Parameters<typeof Canopy.boot>[0] }
  if (!applicationModule.Application) throw new ArborCommandError('dist/application.js must export Application.')
  const environment = { ...await dotenvEnvironment(cwd), ...process.env }
  const runtime = await Canopy.boot(applicationModule.Application, {
    artifactsDirectory: path.join(cwd, '.canopy'),
    dotenvPath: false,
    environment,
    roles: { worker: true, scheduler: true },
    logging: loggingOptions(environment),
  })
  let host: HonoHttpHost | undefined
  try {
    const port = integerOption(args, 'port', Number(environment.PORT ?? 3000))
    const hostname = option(args, 'host') ?? environment.HOST ?? '127.0.0.1'
    host = await HonoHttpHost.listen(runtime, { port, hostname })
    runtime.logger.channel('lifecycle').info('Development server ready', {
      url: host.url.toString(),
      routes: runtime.manifest.routes.length,
      hmr: true,
    })
    process.send?.({ type: 'ready', url: host.url.toString() })
    await waitForShutdown(() => host!.shutdown())
  } catch (error) {
    if (!host) await runtime.shutdown().catch(() => undefined)
    throw error
  }
}

async function runApplicationCommand(name: string, args: readonly string[], cwd: string): Promise<boolean> {
  const result = await buildApplication(cwd)
  if (!result.manifest.commands.some((command) => command.command === name)) return false
  const module = await import(pathToFileURL(path.join(cwd, 'dist/application.js')).href) as { Application?: Parameters<typeof Canopy.boot>[0] }
  if (!module.Application) throw new ArborCommandError('dist/application.js must export Application.')
  const environment = { ...await dotenvEnvironment(cwd), ...process.env }
  const runtime = await Canopy.boot(module.Application, {
    artifactsDirectory: path.join(cwd, '.canopy'),
    dotenvPath: false,
    environment,
    roles: { worker: false, scheduler: false },
    logging: loggingOptions(environment),
  })
  try {
    await runtime.admit({
      actor: { kind: 'system', id: 'canopy:arbor' },
      authentication: { state: 'authenticated', identityId: 'canopy:arbor', method: 'console' },
      transport: { kind: 'console', name },
    }, () => runtime.dispatchCommand(name, args))
  } finally { await runtime.shutdown() }
  return true
}

async function describeAuthStorage(cwd: string, args: readonly string[], io: ArborIo): Promise<void> {
  await buildApplication(cwd)
  const module = await import(pathToFileURL(path.join(cwd, 'dist/application.js')).href) as { Application?: Parameters<typeof Canopy.boot>[0] }
  if (!module.Application) throw new ArborCommandError('dist/application.js must export Application.')
  const runtime = await Canopy.boot(module.Application, {
    artifactsDirectory: path.join(cwd, '.canopy'),
    dotenvPath: false,
    environment: {
      ...await dotenvEnvironment(cwd),
      ...process.env,
      DATABASE_CONNECTION_STRING: await databaseConnection(cwd, args),
    },
    roles: { worker: false, scheduler: false },
    logging: false,
  })
  try {
    const storage = runtime.authenticationStorage()
    io.out(`authentication ${storage.kind}`)
    for (const [name, entry] of Object.entries(storage)) {
      if (name === 'kind' || !entry || typeof entry !== 'object') continue
      const table = entry as { table: string; ownership: string }
      io.out(`${name.padEnd(14)} ${table.ownership.padEnd(8)} ${table.table}`)
    }
  } finally { await runtime.shutdown() }
}

function runProcess(
  command: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: 'inherit', env: environment })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })
}

async function waitForShutdown(shutdown: () => Promise<void>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let closing = false
    const close = () => {
      if (closing) return
      closing = true
      process.off('SIGINT', close)
      process.off('SIGTERM', close)
      void shutdown().then(resolve, reject)
    }
    process.once('SIGINT', close)
    process.once('SIGTERM', close)
  })
}

async function dotenvEnvironment(cwd: string): Promise<Record<string, string>> {
  let content: string
  try { content = await readFile(path.join(cwd, '.env'), 'utf8') } catch { return {} }
  const environment: Record<string, string> = {}
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match) continue
    const value = match[2]!
    environment[match[1]!] = ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) ? value.slice(1, -1) : value
  }
  return environment
}

function integerOption(args: readonly string[], name: string, fallback: number): number {
  const value = option(args, name)
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) throw new ArborCommandError(`--${name} must be an integer from 0 through 65535.`)
  return parsed
}

function numberOption(args: readonly string[], name: string, fallback: number): number {
  const value = option(args, name)
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new ArborCommandError(`--${name} must be a positive number.`)
  return parsed
}

function positiveIntegerOption(args: readonly string[], name: string, fallback: number): number {
  const value = option(args, name)
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new ArborCommandError(`--${name} must be a positive integer.`)
  return parsed
}

async function fileExists(file: string): Promise<boolean> {
  try { await readFile(file); return true } catch { return false }
}

function loggingOptions(environment: Readonly<Record<string, string | undefined>>): {
  readonly level: LogLevel
  readonly format?: LogFormat
  readonly color?: boolean
} {
  const level = environment.CANOPY_LOG_LEVEL ?? 'info'
  if (!['debug', 'info', 'warn', 'error', 'fatal'].includes(level)) {
    throw new ArborCommandError('CANOPY_LOG_LEVEL must be debug, info, warn, error, or fatal.')
  }
  const format = environment.CANOPY_LOG_FORMAT
  if (format !== undefined && format !== 'pretty' && format !== 'json') {
    throw new ArborCommandError('CANOPY_LOG_FORMAT must be pretty or json.')
  }
  return {
    level: level as LogLevel,
    ...(format ? { format } : {}),
    ...(environment.NO_COLOR !== undefined ? { color: false } : {}),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function makeFeature(cwd: string, rawName: string): Promise<void> {
  const name = pascal(rawName)
  const segment = kebab(name)
  const directory = path.join(cwd, 'src', segment)
  await mkdir(directory, { recursive: true })
  await writeNew(path.join(directory, `${segment}.feature.ts`), `import { Feature } from '@canopy/core'\n\nexport class ${name}Feature extends Feature {\n  id = '${segment}'\n}\n`)
  await registerApplicationFeature(path.join(cwd, 'src/application.ts'), `${name}Feature`, `./${segment}/${segment}.feature.js`)
}

async function registerApplicationFeature(applicationFile: string, className: string, specifier: string): Promise<void> {
  let source: string
  try { source = await readFile(applicationFile, 'utf8') } catch { return }
  if (source.includes(`{ ${className} }`)) return
  source = source.replace(/(export class )/, `import { ${className} } from '${specifier}'\n\n$1`)
  const existing = /(\n  features\s*=\s*\[)([^\]]*)(\])/
  if (!existing.test(source)) throw new ArborCommandError('Application must declare a literal features array.')
  source = source.replace(existing, (_match, open: string, contents: string, close: string) => {
    const trimmed = contents.trim()
    return `${open}${trimmed ? `${trimmed}, ` : ''}${className}${close}`
  })
  await writeFile(applicationFile, source, 'utf8')
}

interface Target { readonly feature: string; readonly name: string }
type GeneratorRole = 'model' | 'action' | 'query' | 'route' | 'event' | 'listener'
  | 'signal' | 'signal-handler' | 'observer' | 'job' | 'schedule' | 'policy'
  | 'config' | 'provider' | 'service' | 'command'

async function makeRole(
  cwd: string,
  role: GeneratorRole,
  target: Target,
  arguments_: readonly string[],
): Promise<string> {
  const definition = roleDefinition(role, target, arguments_)
  const field = definition.field
  const folder = definition.folder
  const className = pascal(target.name)
  const fileName = `${kebab(className)}.ts`
  const directory = path.join(cwd, 'src', target.feature, folder)
  const featureFile = path.join(cwd, 'src', target.feature, `${target.feature}.feature.ts`)
  await mkdir(directory, { recursive: true })
  const source = definition.source(className)
  const file = path.join(directory, fileName)
  await writeNew(file, source)
  if (field) await registerFeatureClass(featureFile, field, className, `./${folder}/${kebab(className)}.js`)
  return file
}

function roleDefinition(role: GeneratorRole, target: Target, args: readonly string[]): {
  readonly field?: string
  readonly folder: string
  readonly source: (name: string) => string
} {
  const access = ['action', 'query', 'route', 'listener', 'signal-handler', 'job', 'schedule', 'command'].includes(role)
    ? parseAccess(args) : undefined
  const simple = (base: string, extra = '') => (name: string) => `import { ${base} } from '@canopy/core'\n\nexport class ${name} extends ${base} {\n  static override readonly id = '${kebab(name)}'\n${extra}}\n`
  if (role === 'model') return { field: 'models', folder: 'models', source: (name) => `import { Model, type ModelAttributes } from '@canopy/core'\n\nexport interface ${name}Attributes extends ModelAttributes {}\n\nexport class ${name} extends Model<${name}Attributes> {\n  static override readonly id = '${kebab(name)}'\n}\n` }
  if (role === 'action' || role === 'query') return { field: `${role}s`, folder: `${role}s`, source: (name) => `import { ${pascal(role)} } from '@canopy/core'\n\nexport class ${name} extends ${pascal(role)}<void, void> {\n  static id = '${kebab(name)}'\n  static override readonly access = '${access}'\n\n  async handle(): Promise<void> {\n    // TODO: implement ${name}.\n  }\n}\n` }
  if (role === 'event') return { field: 'events', folder: 'events', source: simple('Event') }
  if (role === 'signal') return { field: 'signals', folder: 'signals', source: simple('Signal') }
  if (role === 'route') {
    const method = option(args, 'method')?.toUpperCase()
    const routePath = option(args, 'path')
    if (!method || !['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'].includes(method)) throw new ArborCommandError('Routes require --method=GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS.')
    if (!routePath?.startsWith('/')) throw new ArborCommandError('Routes require an absolute --path=/... value.')
    return { field: 'routes', folder: 'http', source: (name) => `import { type HttpRequest, Route } from '@canopy/core'\n\nexport class ${name} extends Route {\n  static override readonly id = '${kebab(name)}'\n  static override readonly access = '${access}'\n  readonly method = '${method}'\n  readonly path = '${routePath}'\n\n  handle(_request: HttpRequest) {\n    return { message: '${kebab(name)}' }\n  }\n}\n` }
  }
  if (role === 'listener') {
    const related = pascal(required(option(args, 'event'), 'Listeners require --event=EventName.'))
    const delivery = args.includes('--queued-after-commit') ? 'ShouldQueueAfterCommit'
      : args.includes('--queued') ? 'ShouldQueue'
        : args.includes('--after-commit') ? 'ShouldHandleEventsAfterCommit' : undefined
    return { field: 'listeners', folder: 'listeners', source: (name) => `import { Listener${delivery ? `, type ${delivery}` : ''} } from '@canopy/core'\nimport { ${related} } from '../events/${kebab(related)}.js'\n\nexport class ${name} extends Listener<${related}>${delivery ? ` implements ${delivery}` : ''} {\n  static id = '${kebab(name)}'\n  static override readonly access = '${access}'\n  async handle(_event: ${related}): Promise<void> {}\n}\n` }
  }
  if (role === 'signal-handler') {
    const related = pascal(required(option(args, 'signal'), 'Signal handlers require --signal=SignalName.'))
    return { field: 'signalHandlers', folder: 'signal-handlers', source: (name) => `import { SignalHandler } from '@canopy/core'\nimport { ${related} } from '../signals/${kebab(related)}.js'\n\nexport class ${name} extends SignalHandler<${related}> {\n  static id = '${kebab(name)}'\n  static override readonly access = '${access}'\n  async handle(_signal: ${related}): Promise<void> {}\n}\n` }
  }
  if (role === 'observer') {
    const related = pascal(required(option(args, 'model'), 'Observers require --model=ModelName.'))
    return { field: 'observers', folder: 'observers', source: (name) => `import { Observer } from '@canopy/core'\nimport { ${related} } from '../models/${kebab(related)}.js'\n\nexport class ${name} extends Observer<${related}> {\n  static id = '${kebab(name)}'\n  async saved(_model: ${related}): Promise<void> {}\n}\n` }
  }
  if (role === 'job') return { field: 'jobs', folder: 'jobs', source: (name) => `import { Job } from '@canopy/core'\n\nexport class ${name} extends Job<void> {\n  static override readonly id = '${kebab(name)}'\n  static override readonly access = '${access}'\n  async handle(): Promise<void> {}\n}\n` }
  if (role === 'schedule') {
    const job = pascal(required(option(args, 'job'), 'Schedules require --job=JobName.'))
    const cron = option(args, 'cron'); const every = option(args, 'every')
    if (Boolean(cron) === Boolean(every)) throw new ArborCommandError('Schedules require exactly one of --cron= or --every=seconds.')
    if (every && (!Number.isFinite(Number(every)) || Number(every) <= 0)) throw new ArborCommandError('--every must be a positive number of seconds.')
    return { field: 'schedules', folder: 'schedules', source: (name) => `import { Schedule } from '@canopy/core'\nimport { ${job} } from '../jobs/${kebab(job)}.js'\n\nexport class ${name} extends Schedule<void> {\n  static override readonly id = '${kebab(name)}'\n  static override readonly access = '${access}'\n  static override readonly job = ${job}\n  static override readonly ${cron ? `cron = ${JSON.stringify(cron)}` : `everySeconds = ${Number(every)}`}\n  static override readonly input = undefined\n}\n` }
  }
  if (role === 'policy') {
    const abilities = required(option(args, 'abilities'), 'Policies require --abilities=one,two.').split(',').map((value) => value.trim()).filter(Boolean)
    if (abilities.length === 0) throw new ArborCommandError('Policies require at least one ability.')
    return { field: 'policies', folder: 'policies', source: (name) => `import { allow, deny, Policy, type PolicyRequest, type PolicyDecision } from '@canopy/core'\n\nexport class ${name} extends Policy {\n  static id = '${kebab(name)}'\n  static override readonly abilities = ${JSON.stringify(abilities)}\n  decide(request: PolicyRequest): PolicyDecision {\n    return request.actor.kind === 'anonymous' ? deny('authentication_required') : allow('authenticated')\n  }\n}\n` }
  }
  if (role === 'config') return { field: 'configs', folder: 'config', source: (name) => `import { Configuration } from '@canopy/core'\n\nexport class ${name} extends Configuration {\n  declare enabled: boolean\n}\n` }
  if (role === 'provider') return { field: 'providers', folder: 'providers', source: (name) => `export class ${name} {\n  static id = '${kebab(name)}'\n}\n` }
  if (role === 'command') {
    const commandName = option(args, 'name') ?? `${target.feature}:${kebab(target.name)}`
    const description = option(args, 'description') ?? ''
    return { field: 'commands', folder: 'commands', source: (name) => `import { Command } from '@canopy/core'\n\nexport class ${name} extends Command {\n  static override readonly id = '${kebab(name)}'\n  static override readonly name = '${commandName}'\n  static override readonly description = ${JSON.stringify(description)}\n  static override readonly access = '${access}'\n\n  async handle(_arguments: readonly string[]): Promise<void> {}\n}\n` }
  }
  return { folder: 'services', source: (name) => `export class ${name} {}\n` }
}

async function registerFeatureClass(featureFile: string, field: string, className: string, specifier: string): Promise<void> {
  let source = await readFile(featureFile, 'utf8')
  if (source.includes(`{ ${className} }`)) throw new ArborCommandError(`${className} is already registered.`)
  source = source.replace(/(export class )/, `import { ${className} } from '${specifier}'\n\n$1`)
  const existing = new RegExp(`(\\n  ${field}\\s*=\\s*\\[)([^\\]]*)(\\])`)
  if (existing.test(source)) {
    source = source.replace(existing, (_match, open: string, contents: string, close: string) => {
      const trimmed = contents.trim()
      return `${open}${trimmed ? `${trimmed}, ` : ''}${className}${close}`
    })
  } else {
    source = source.replace(/\n}\s*$/, `\n  ${field} = [${className}]\n}\n`)
  }
  await writeFile(featureFile, source, 'utf8')
}

function generatorRole(command: string): GeneratorRole | undefined {
  const value = command.startsWith('make:') ? command.slice(5) : ''
  return ['model', 'action', 'query', 'route', 'event', 'listener', 'signal', 'signal-handler', 'observer', 'job', 'schedule', 'policy', 'config', 'provider', 'service', 'command'].includes(value)
    ? value as GeneratorRole : undefined
}

function inspectionField(command: string): string | undefined {
  return ({
    'event:list': 'events',
    'listener:list': 'listeners',
    'observer:list': 'observers',
    'job:list': 'jobs',
    'schedule:list': 'schedules',
    'policy:list': 'policies',
    'command:list': 'commands',
  } as Record<string, string>)[command]
}

function formatInspection(field: string, entry: Record<string, unknown>): string {
  if (field === 'events') return `${String(entry.id)} ${String(entry.dispatch)}`
  if (field === 'listeners') return `${String(entry.id)} <- ${String(entry.eventId)} ${String(entry.delivery)} ${String(entry.access)}`
  if (field === 'observers') return `${String(entry.id)} <- ${String(entry.modelId)} ${(entry.phases as unknown[]).join(',')}`
  if (field === 'jobs') return `${String(entry.id)} retries=${String(entry.retries)} timeout=${String(entry.timeout)} access=${String(entry.access)}`
  if (field === 'schedules') return `${String(entry.id)} -> ${String(entry.jobId)} ${JSON.stringify(entry.cadence)}`
  if (field === 'policies') return `${String(entry.id)} ${(entry.abilities as unknown[]).join(',')}`
  return `${String(entry.command)} ${String(entry.access)} ${String(entry.description)}`
}

async function makeMigration(cwd: string, rawName: string): Promise<string> {
  const now = new Date()
  const timestamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('')
  const directory = path.join(cwd, 'migrations')
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, `${timestamp}_${kebab(rawName)}.sql`)
  await writeNew(file, `-- ${rawName}\n-- Write a forward-only, production-safe migration.\n`)
  return file
}

async function makeTest(cwd: string, target: Target): Promise<string> {
  const name = pascal(target.name)
  const directory = path.join(cwd, 'tests', target.feature)
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, `${kebab(name)}.test.ts`)
  await writeNew(file, `import { describe, expect, it } from 'vitest'\n\ndescribe('${name}', () => {\n  it('works', () => {\n    expect(true).toBe(true)\n  })\n})\n`)
  return file
}

function parseTarget(value: string): Target {
  const parts = value.split('/').filter(Boolean)
  if (parts.length !== 2) throw new ArborCommandError('Generator target must be Feature/Name.')
  return { feature: kebab(parts[0]!), name: parts[1]! }
}

function parseAccess(arguments_: readonly string[]): string {
  if (arguments_.includes('--public')) return 'public'
  const ability = arguments_.find((argument) => argument.startsWith('--ability='))?.slice(10)
  if (ability) return ability
  throw new ArborCommandError('Framework entry roles require --public or --ability=<stable ability>.')
}

function option(arguments_: readonly string[], name: string): string | undefined {
  return arguments_.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3)
}

async function writeNew(file: string, content: string): Promise<void> {
  try {
    await writeFile(file, content, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ArborCommandError(`${file} already exists.`)
    throw error
  }
}

function required(value: string | undefined, message: string): string {
  if (!value) throw new ArborCommandError(message)
  return value
}

function pascal(value: string): string {
  return value.split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')
}

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()
}

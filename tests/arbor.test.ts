import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { runArbor } from '@canopy/arbor'
import type { CanopyApplication } from '@canopy/core'
import {
  CanopyTestHarness,
  FakeMailTransport,
  FakeQueueManager,
  FakeSmsTransport,
  MemoryCache,
  MemoryTransactionManager,
} from '@canopy/testing'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []
const workspace = path.resolve(import.meta.dirname, '..')

describe('Arbor command suite', () => {
  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    )
  })

  it('generates a Feature and registers generated model and action declarations', async () => {
    const root = await temporaryDirectory()
    const output: string[] = []
    const errors: string[] = []
    const io = {
      out: (message: string) => output.push(message),
      error: (message: string) => errors.push(message),
    }

    expect(await runArbor(['make:feature', 'Accounts'], root, io)).toBe(0)
    expect(await runArbor(['make:model', 'Accounts/User'], root, io)).toBe(0)
    expect(
      await runArbor(
        ['make:action', 'Accounts/RegisterUser', '--ability=accounts.register'],
        root,
        io,
      ),
    ).toBe(0)

    const feature = await readFile(path.join(root, 'src/accounts/accounts.feature.ts'), 'utf8')
    expect(feature).toContain("import { User } from './models/user.js'")
    expect(feature).toContain("import { RegisterUser } from './actions/register-user.js'")
    expect(feature).toContain('models = [User]')
    expect(feature).toContain('actions = [RegisterUser]')
    expect(
      await readFile(path.join(root, 'src/accounts/actions/register-user.ts'), 'utf8'),
    ).toContain("static override readonly access = 'accounts.register'")
    expect(errors).toEqual([])
  })

  it('fails closed when an operation generator omits its authorization posture', async () => {
    const root = await temporaryDirectory()
    const errors: string[] = []
    await runArbor(['make:feature', 'Accounts'], root, {
      out: () => undefined,
      error: () => undefined,
    })
    expect(
      await runArbor(['make:action', 'Accounts/RegisterUser'], root, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(1)
    expect(errors).toEqual([
      'Framework entry roles require --public or --ability=<stable ability>.',
    ])
  })

  it('launches pinned Drizzle Studio through db:studio without exposing credentials in arguments', async () => {
    const root = await temporaryDirectory()
    const connectionString = 'postgresql://canopy:private-password@127.0.0.1:54329/canopy'
    await writeFile(path.join(root, '.env'), `DATABASE_CONNECTION_STRING=${connectionString}\n`)
    const output: string[] = []
    let invocation:
      | {
          command: string
          arguments_: readonly string[]
          cwd: string
          environment: NodeJS.ProcessEnv
        }
      | undefined

    expect(
      await runArbor(['db:studio', '--host=127.0.0.1', '--port=5099', '--verbose'], root, {
        out: (message) => output.push(message),
        error: (message) => {
          throw new Error(message)
        },
        run: (command, arguments_, cwd, environment) => {
          invocation = { command, arguments_, cwd, environment }
          return Promise.resolve(0)
        },
      }),
    ).toBe(0)

    expect(invocation).toEqual(
      expect.objectContaining({
        command: process.execPath,
        cwd: root,
        environment: expect.objectContaining({ DATABASE_CONNECTION_STRING: connectionString }),
      }),
    )
    expect(invocation?.arguments_[0]).toMatch(/drizzle-kit[/\\]bin\.cjs$/)
    expect(invocation?.arguments_).toEqual(
      expect.arrayContaining([
        'studio',
        `--config=${path.join(root, '.canopy/drizzle-studio.config.mjs')}`,
        '--host=127.0.0.1',
        '--port=5099',
        '--verbose',
      ]),
    )
    expect(invocation?.arguments_.join(' ')).not.toContain('private-password')
    expect(await readFile(path.join(root, '.canopy/drizzle-studio.config.mjs'), 'utf8')).toContain(
      'process.env.DATABASE_CONNECTION_STRING',
    )
    expect(output).toEqual(['Starting Drizzle Studio for Canopy (proxy 127.0.0.1:5099).'])
  })

  it('generates and registers every canonical framework role', async () => {
    const root = await temporaryDirectory()
    const io = {
      out: () => undefined,
      error: (message: string) => {
        throw new Error(message)
      },
    }
    await runArbor(['make:feature', 'Commerce'], root, io)
    const commands = [
      ['make:model', 'Commerce/Order'],
      ['make:event', 'Commerce/OrderPlaced'],
      [
        'make:listener',
        'Commerce/NotifyWarehouse',
        '--event=OrderPlaced',
        '--queued-after-commit',
        '--public',
      ],
      ['make:signal', 'Commerce/OrderTouched'],
      ['make:signal-handler', 'Commerce/RecordOrderTouched', '--signal=OrderTouched', '--public'],
      ['make:observer', 'Commerce/OrderObserver', '--model=Order'],
      ['make:job', 'Commerce/ShipOrder', '--ability=orders.ship'],
      ['make:schedule', 'Commerce/ShipPendingOrders', '--job=ShipOrder', '--every=60', '--public'],
      ['make:policy', 'Commerce/OrderPolicy', '--abilities=orders.view,orders.ship'],
      [
        'make:route',
        'Commerce/ListOrdersRoute',
        '--method=GET',
        '--path=/orders',
        '--ability=orders.view',
      ],
      ['make:config', 'Commerce/CommerceConfig'],
      ['make:provider', 'Commerce/WarehouseProvider'],
      ['make:service', 'Commerce/CalculateOrderTotal'],
      [
        'make:command',
        'Commerce/RebuildProjections',
        '--name=commerce:rebuild-projections',
        '--public',
      ],
    ]
    for (const command of commands) expect(await runArbor(command, root, io)).toBe(0)
    const feature = await readFile(path.join(root, 'src/commerce/commerce.feature.ts'), 'utf8')
    for (const field of [
      'models',
      'events',
      'listeners',
      'signals',
      'signalHandlers',
      'observers',
      'jobs',
      'schedules',
      'policies',
      'routes',
      'configs',
      'providers',
      'commands',
    ]) {
      expect(feature).toContain(`${field} = [`)
    }
    expect(feature).not.toContain('services =')
    expect(
      await readFile(path.join(root, 'src/commerce/listeners/notify-warehouse.ts'), 'utf8'),
    ).toContain('implements ShouldQueueAfterCommit')
    expect(
      await readFile(path.join(root, 'src/commerce/schedules/ship-pending-orders.ts'), 'utf8'),
    ).toContain('everySeconds = 60')
    expect(
      await readFile(path.join(root, 'src/commerce/policies/order-policy.ts'), 'utf8'),
    ).toContain('orders.ship')
  })

  it('registers new Features in an existing Application and creates migrations and tests', async () => {
    const root = await temporaryDirectory()
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(
      path.join(root, 'src/application.ts'),
      "import { CanopyApplication } from '@canopy/core'\n\nexport class Application extends CanopyApplication {\n  id = 'fixture'\n  features = []\n}\n",
    )
    const io = {
      out: () => undefined,
      error: (message: string) => {
        throw new Error(message)
      },
    }
    expect(await runArbor(['make:feature', 'Accounts'], root, io)).toBe(0)
    expect(await readFile(path.join(root, 'src/application.ts'), 'utf8')).toContain(
      'features = [AccountsFeature]',
    )
    expect(await runArbor(['make:migration', 'create orders'], root, io)).toBe(0)
    expect(await runArbor(['make:test', 'Accounts/RegisterUser'], root, io)).toBe(0)
    expect(
      await readFile(path.join(root, 'tests/accounts/register-user.test.ts'), 'utf8'),
    ).toContain("describe('RegisterUser'")
  })

  it('creates an opinionated runnable application skeleton in a clean directory', async () => {
    const root = await temporaryDirectory()
    const destination = path.join(root, 'garden')
    const output: string[] = []
    const errors: string[] = []
    expect(
      await runArbor(['new', 'Garden', `--directory=${destination}`], root, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(0)
    const application = await readFile(path.join(destination, 'src/application.ts'), 'utf8')
    const feature = await readFile(path.join(destination, 'src/app/app.feature.ts'), 'utf8')
    expect(application).toContain("id = 'garden'")
    expect(application).toContain(
      'features = [InfrastructureFeature, AccountsFeature, TasksFeature, AppFeature]',
    )
    expect(feature).toContain('routes = [HomeRoute, HealthRoute]')
    expect(JSON.parse(await readFile(path.join(destination, 'package.json'), 'utf8'))).toEqual(
      expect.objectContaining({
        packageManager: 'pnpm@11.10.0',
        scripts: expect.objectContaining({
          dev: 'arbor dev',
          start: 'arbor serve',
          background: 'arbor work',
          work: 'arbor work',
          schedule: 'arbor schedule',
          'db:studio': 'arbor db:studio',
        }),
        engines: { node: '>=24 <25' },
      }),
    )
    const dockerfile = await readFile(path.join(destination, 'Dockerfile'), 'utf8')
    expect(dockerfile).toContain('FROM node:${NODE_VERSION}-bookworm-slim AS runtime')
    expect(dockerfile).toContain('RUN pnpm build')
    expect(dockerfile).toContain('RUN pnpm prune --prod')
    expect(dockerfile).toContain('USER node')
    expect(dockerfile).toContain('CMD ["arbor", "serve", "--host=0.0.0.0", "--port=3000"]')
    const productionCompose = await readFile(
      path.join(destination, 'compose.production.yaml'),
      'utf8',
    )
    expect(productionCompose).toContain('command: ["arbor", "work"]')
    expect(productionCompose).toContain('command: ["arbor", "migrate"]')
    expect(productionCompose).not.toContain('arbor schedule')
    expect(productionCompose).not.toContain('depends_on')
    expect(productionCompose).toContain('profiles: ["release"]')
    expect(await readFile(path.join(destination, '.dockerignore'), 'utf8')).toContain('.env.*')
    expect(await readFile(path.join(destination, '.env.example'), 'utf8')).toContain(
      'DATABASE_CONNECTION_STRING=',
    )
    expect(
      await readFile(path.join(destination, 'src/accounts/accounts.feature.ts'), 'utf8'),
    ).toContain('TokenRoute')
    expect(
      await readFile(
        path.join(destination, 'src/infrastructure/infrastructure.feature.ts'),
        'utf8',
      ),
    ).toContain('ApplicationAuth')
    expect(await readFile(path.join(destination, 'src/tasks/tasks.feature.ts'), 'utf8')).toContain(
      'schedules = [ProcessTasks]',
    )
    const generatedHome = await readFile(
      path.join(destination, 'src/app/http/home.route.ts'),
      'utf8',
    )
    const generatedTask = await readFile(
      path.join(destination, 'src/tasks/complete-task.ts'),
      'utf8',
    )
    const generatedEvent = await readFile(
      path.join(destination, 'src/tasks/task-completed.event.ts'),
      'utf8',
    )
    expect(generatedHome).toContain('this.logger.info')
    expect(generatedHome).not.toContain('constructor(')
    expect(generatedTask).toContain('this.inject(Authorization)')
    expect(generatedTask).not.toContain('super()')
    expect(generatedEvent).toContain('extends Event<{ taskId: string; ownerId: string }>')
    expect(generatedEvent).not.toContain('constructor(')
    await symlink(path.join(workspace, 'node_modules'), path.join(destination, 'node_modules'))
    expect(
      await runArbor(['build'], destination, {
        out: (message) => output.push(message),
        error: (message) => errors.push(message),
      }),
    ).toBe(0)
    const generatedManifest = JSON.parse(
      await readFile(path.join(destination, '.canopy/manifest.json'), 'utf8'),
    ) as {
      applicationId: string
      buildHash: string
      actions: Array<{ id: string; dependencies: Array<{ kind: string; targetId?: string }> }>
    }
    expect(generatedManifest).toEqual(expect.objectContaining({ applicationId: 'garden' }))
    expect(
      generatedManifest.actions.find((action) => action.id.endsWith('/complete-task'))
        ?.dependencies,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'role', targetId: 'canopy:authorization' }),
      ]),
    )
    const cultivate = JSON.parse(
      await readFile(path.join(destination, '.canopy/cultivate.json'), 'utf8'),
    ) as {
      deployment: Record<string, unknown>
    }
    expect(cultivate.deployment).toEqual(
      expect.objectContaining({
        strategy: 'one-immutable-image',
        roles: expect.objectContaining({
          web: expect.objectContaining({ command: 'arbor serve' }),
          background: expect.objectContaining({ command: 'arbor work', admitsSchedules: true }),
          migration: expect.objectContaining({ command: 'arbor migrate', automaticOnBoot: false }),
        }),
        advancedIsolation: {
          workerCommand: 'arbor work --without-scheduler',
          schedulerCommand: 'arbor schedule',
          useWhen: 'schedule admission requires independent resources or fault isolation',
        },
      }),
    )
    const manifest = generatedManifest
    const registry = (await import(
      `${pathToFileURL(path.join(destination, '.canopy/registry.mjs')).href}?buildHash=${manifest.buildHash}`
    )) as {
      constructors: Record<string, abstract new () => CanopyApplication>
    }
    const GeneratedApplication = registry.constructors['application:garden']!
    const queue = new FakeQueueManager()
    const transactions = new MemoryTransactionManager(queue)
    const mail = new FakeMailTransport()
    const sms = new FakeSmsTransport()
    const harness = await CanopyTestHarness.boot(GeneratedApplication, {
      artifactsDirectory: path.join(destination, '.canopy'),
      dotenvPath: false,
      environment: { DATABASE_CONNECTION_STRING: 'generated-memory-database' },
      authProviderId: 'provider:infrastructure/auth',
      providerOverrides: {
        'provider:infrastructure/transactions': transactions,
        'provider:infrastructure/queues': queue,
        'provider:infrastructure/cache': new MemoryCache(),
        'provider:infrastructure/mail': mail,
        'provider:infrastructure/sms': sms,
      },
    })
    try {
      harness.actingAsUser('generated-user')
      const completed = await harness.request('http://canopy.test/tasks/generated-task/complete', {
        method: 'POST',
      })
      expect(completed.status).toBe(200)
      expect(await completed.json()).toEqual({
        ok: true,
        data: expect.objectContaining({ id: 'generated-task', completed: true }),
      })
      expect(transactions.state.entities.get('model:tasks/task/generated-task')).toEqual(
        expect.objectContaining({ version: 1 }),
      )
      expect(transactions.state.journal).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'task.completed' })]),
      )
      expect(queue.hasQueued('process-task')).toBe(true)
      while (queue.queued.length > 0) await queue.runNext()
      expect(mail.sent).toHaveLength(1)
      expect(sms.sent).toHaveLength(1)
      await queue.runSchedule('schedule:tasks/process-tasks')
    } finally {
      await harness.shutdown()
    }
    expect(errors).toEqual([])
  })

  it('installs and wires Undergrowth without manual package or Feature edits', async () => {
    const root = await temporaryDirectory()
    const destination = path.join(root, 'garden')
    const messages: string[] = []
    const io = {
      out: (message: string) => messages.push(message),
      error: (message: string) => {
        throw new Error(message)
      },
    }
    expect(await runArbor(['new', 'Garden', `--directory=${destination}`], root, io)).toBe(0)
    expect(await runArbor(['add', 'undergrowth'], destination, io)).toBe(0)
    const packageJson = JSON.parse(
      await readFile(path.join(destination, 'package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>
      scripts: Record<string, string>
    }
    expect(packageJson.dependencies['@canopy/undergrowth']).toBe('^0.1.0-alpha.0')
    expect(packageJson.scripts).toEqual(
      expect.objectContaining({
        undergrowth: 'arbor undergrowth',
        'undergrowth:prune': 'arbor undergrowth:prune',
      }),
    )
    expect(
      await readFile(path.join(destination, 'src/infrastructure/undergrowth.ts'), 'utf8'),
    ).toContain('extends PostgresUndergrowth')
    expect(
      await readFile(
        path.join(destination, 'src/infrastructure/infrastructure.feature.ts'),
        'utf8',
      ),
    ).toContain('ApplicationUndergrowth]')
    expect(messages.at(-1)).toContain('Run arbor migrate, then arbor undergrowth')
  })

  it('fails production roles closed when prebuilt artifacts are absent', async () => {
    const root = await temporaryDirectory()
    const errors: string[] = []
    expect(
      await runArbor(['work'], root, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(1)
    expect(errors).toEqual([
      expect.stringContaining('Prebuilt Canopy artifacts are missing or invalid. Run arbor build'),
    ])
  })

  it('boots background roles from prebuilt artifacts with scheduling enabled by default', async () => {
    const root = await temporaryDirectory()
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }))
    await writeFile(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2024',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          rootDir: 'src',
          outDir: 'dist',
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      }),
    )
    await writeFile(
      path.join(root, 'src/application.ts'),
      `import { CanopyApplication, Feature, QueueManager } from '@canopy/core'
import type { QueueDeliveryHandler, QueueEnvelope, QueueJobRecord, QueueRuntimeRoles, ScheduleDefinition } from '@canopy/core'

export class DeploymentQueue extends QueueManager {
  static id = 'deployment-queue'
  override selectRoles(roles: QueueRuntimeRoles): void { console.log('CANOPY_ROLES:' + JSON.stringify(roles)) }
  bind(_handler: QueueDeliveryHandler): void {}
  reconcileSchedules(_schedules: readonly ScheduleDefinition[]): void {}
  async enqueue(envelope: QueueEnvelope): Promise<string> { return envelope.id }
  async flushOutbox(): Promise<number> { return 0 }
  async findJob(_id: string): Promise<QueueJobRecord | undefined> { return undefined }
}

export class InfrastructureFeature extends Feature {
  id = 'infrastructure'
  providers = [DeploymentQueue]
}

export class Application extends CanopyApplication {
  id = 'deployment-fixture'
  features = [InfrastructureFeature]
}
`,
    )
    await symlink(path.join(workspace, 'node_modules'), path.join(root, 'node_modules'))
    expect(
      await runArbor(['build'], root, {
        out: () => undefined,
        error: (message) => {
          throw new Error(message)
        },
      }),
    ).toBe(0)
    await rm(path.join(root, 'src'), { recursive: true })
    await rm(path.join(root, 'tsconfig.json'))

    expect(await runPrebuiltRole(root, ['work'])).toContain(
      'CANOPY_ROLES:{"worker":true,"scheduler":true}',
    )
    expect(await runPrebuiltRole(root, ['work', '--without-scheduler'])).toContain(
      'CANOPY_ROLES:{"worker":true,"scheduler":false}',
    )
    expect(await runPrebuiltRole(root, ['schedule'])).toContain(
      'CANOPY_ROLES:{"worker":false,"scheduler":true}',
    )
  })
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'canopy-arbor-'))
  directories.push(directory)
  return directory
}

async function runPrebuiltRole(cwd: string, arguments_: readonly string[]): Promise<string> {
  const child = spawn(
    process.execPath,
    [path.join(workspace, 'packages/arbor/dist/bin.js'), ...arguments_],
    {
      cwd,
      env: { ...process.env, PATH: '/canopy-production-has-no-build-tools' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    output += chunk
  })
  child.stderr.on('data', (chunk: string) => {
    output += chunk
  })
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Prebuilt role did not become ready. ${output}`)),
      10_000,
    )
    const inspect = () => {
      if (!output.includes('role ready')) return
      clearTimeout(timeout)
      resolve()
    }
    child.stdout.on('data', inspect)
    child.once('error', reject)
    child.once('exit', (code) => {
      if (!output.includes('role ready'))
        reject(new Error(`Prebuilt role exited early (${code}). ${output}`))
    })
  })
  child.kill('SIGTERM')
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Prebuilt role did not stop.'))
    }, 10_000)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolve()
      else reject(new Error(`Prebuilt role exited with ${code}. ${output}`))
    })
  })
  return output
}

import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { runPraxis } from '@doxajs/praxis'
import type { DoxaApplication } from '@doxajs/core'
import {
  DoxaTestHarness,
  FakeMailTransport,
  FakeQueueManager,
  FakeSmsTransport,
  MemoryCache,
  MemoryTransactionManager,
} from '@doxajs/testing'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []
const workspace = path.resolve(import.meta.dirname, '..')

describe('Praxis command suite', () => {
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

    expect(await runPraxis(['make:feature', 'Accounts'], root, io)).toBe(0)
    expect(await runPraxis(['make:model', 'Accounts/User'], root, io)).toBe(0)
    expect(
      await runPraxis(
        ['make:action', 'Accounts/RegisterUser', '--ability=accounts.register'],
        root,
        io,
      ),
    ).toBe(0)

    const feature = await readFile(
      path.join(root, 'src/features/accounts/accounts.feature.ts'),
      'utf8',
    )
    expect(feature).toContain("import { User } from './models/user.js'")
    expect(feature).toContain("import { RegisterUser } from './actions/register-user.js'")
    expect(feature).toContain('models = [User]')
    expect(feature).toContain('actions = [RegisterUser]')
    expect(
      await readFile(path.join(root, 'src/features/accounts/actions/register-user.ts'), 'utf8'),
    ).toContain("static override readonly access = 'accounts.register'")
    expect(errors).toEqual([])
  })

  it('fails closed when an operation generator omits its authorization posture', async () => {
    const root = await temporaryDirectory()
    const errors: string[] = []
    await runPraxis(['make:feature', 'Accounts'], root, {
      out: () => undefined,
      error: () => undefined,
    })
    expect(
      await runPraxis(['make:action', 'Accounts/RegisterUser'], root, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(1)
    expect(errors).toEqual([
      'Framework entry roles require --public or --ability=<stable ability>.',
    ])
  })

  it('generates public GET routes by default with optional method and ability overrides', async () => {
    const root = await temporaryDirectory()
    const errors: string[] = []
    const io = {
      out: () => undefined,
      error: (message: string) => errors.push(message),
    }
    await runPraxis(['make:feature', 'Accounts'], root, io)

    expect(
      await runPraxis(['make:route', 'Accounts/ListAccounts', '--path=/accounts'], root, io),
    ).toBe(0)
    const publicRoute = await readFile(
      path.join(root, 'src/features/accounts/http/list-accounts.ts'),
      'utf8',
    )
    expect(publicRoute).toContain("static override readonly access = 'public'")
    expect(publicRoute).toContain("readonly method = 'GET'")

    expect(
      await runPraxis(
        [
          'make:route',
          'Accounts/CreateAccount',
          '--path=/accounts',
          '--method=POST',
          '--ability=accounts.create',
        ],
        root,
        io,
      ),
    ).toBe(0)
    const protectedRoute = await readFile(
      path.join(root, 'src/features/accounts/http/create-account.ts'),
      'utf8',
    )
    expect(protectedRoute).toContain("static override readonly access = 'accounts.create'")
    expect(protectedRoute).toContain("readonly method = 'POST'")
    expect(errors).toEqual([])
  })

  it('rejects the removed --public route option', async () => {
    const root = await temporaryDirectory()
    const errors: string[] = []
    await runPraxis(['make:feature', 'Accounts'], root, {
      out: () => undefined,
      error: () => undefined,
    })

    expect(
      await runPraxis(
        ['make:route', 'Accounts/ListAccounts', '--path=/accounts', '--public'],
        root,
        {
          out: () => undefined,
          error: (message) => errors.push(message),
        },
      ),
    ).toBe(1)
    expect(errors).toEqual([
      'Routes are public by default; omit --public or use --ability=<stable ability>.',
    ])
  })

  it('launches pinned Drizzle Studio through db:studio without exposing credentials in arguments', async () => {
    const root = await temporaryDirectory()
    const connectionString = 'postgresql://doxa:private-password@127.0.0.1:54329/doxa'
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
      await runPraxis(['db:studio', '--host=127.0.0.1', '--port=5099', '--verbose'], root, {
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
        command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
        cwd: root,
        environment: expect.objectContaining({ DATABASE_CONNECTION_STRING: connectionString }),
      }),
    )
    expect(invocation?.arguments_).toEqual([
      'dlx',
      '--allow-build=esbuild',
      'drizzle-kit@0.31.10',
      'studio',
      `--config=${path.join(root, '.doxa/drizzle-studio.config.mjs')}`,
      '--host=127.0.0.1',
      '--port=5099',
      '--verbose',
    ])
    expect(invocation?.arguments_.join(' ')).not.toContain('private-password')
    expect(await readFile(path.join(root, '.doxa/drizzle-studio.config.mjs'), 'utf8')).toContain(
      'process.env.DATABASE_CONNECTION_STRING',
    )
    expect(output).toEqual(['Starting Drizzle Studio for Doxa (proxy 127.0.0.1:5099).'])
  })

  it('generates and registers every canonical framework role', async () => {
    const root = await temporaryDirectory()
    const io = {
      out: () => undefined,
      error: (message: string) => {
        throw new Error(message)
      },
    }
    await runPraxis(['make:feature', 'Commerce'], root, io)
    const commands = [
      ['make:model', 'Commerce/Order'],
      [
        'make:event',
        'Commerce/OrderPlaced',
        '--model=Order',
        '--broadcast',
        '--channel=orders',
        '--private',
      ],
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
      [
        'make:schedule',
        'Commerce/ShipPendingOrders',
        '--job=ShipOrder',
        '--every=60',
        '--misfire=catch-up-once',
        '--public',
      ],
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
    for (const command of commands) expect(await runPraxis(command, root, io)).toBe(0)
    const feature = await readFile(
      path.join(root, 'src/features/commerce/commerce.feature.ts'),
      'utf8',
    )
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
      await readFile(path.join(root, 'src/features/commerce/events/order-placed.ts'), 'utf8'),
    ).toContain('implements ShouldBroadcast')
    expect(
      await readFile(path.join(root, 'src/features/commerce/events/order-placed.ts'), 'utf8'),
    ).toContain('static override readonly model = Order')
    expect(
      await readFile(
        path.join(root, 'src/features/commerce/listeners/notify-warehouse.ts'),
        'utf8',
      ),
    ).toContain('implements ShouldQueueAfterCommit')
    expect(
      await readFile(
        path.join(root, 'src/features/commerce/schedules/ship-pending-orders.ts'),
        'utf8',
      ),
    ).toContain('everySeconds = 60')
    expect(
      await readFile(
        path.join(root, 'src/features/commerce/schedules/ship-pending-orders.ts'),
        'utf8',
      ),
    ).toContain("misfire = 'catch-up-once'")
    expect(
      await readFile(path.join(root, 'src/features/commerce/policies/order-policy.ts'), 'utf8'),
    ).toContain('orders.ship')
  })

  it('registers new Features in an existing Application and creates migrations and tests', async () => {
    const root = await temporaryDirectory()
    await writeFile(
      path.join(root, 'app.config.ts'),
      "import { DoxaApplication } from '@doxajs/core'\n\nexport class Application extends DoxaApplication {\n  id = 'fixture'\n  features = []\n  plugins = []\n}\n",
    )
    const io = {
      out: () => undefined,
      error: (message: string) => {
        throw new Error(message)
      },
    }
    expect(await runPraxis(['make:feature', 'Accounts'], root, io)).toBe(0)
    expect(await readFile(path.join(root, 'app.config.ts'), 'utf8')).toContain(
      'features = [AccountsFeature]',
    )
    expect(await runPraxis(['make:migration', 'create orders'], root, io)).toBe(0)
    expect(await runPraxis(['make:test', 'Accounts/RegisterUser'], root, io)).toBe(0)
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
      await runPraxis(['new', 'Garden', `--directory=${destination}`], root, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(0)
    const application = await readFile(path.join(destination, 'app.config.ts'), 'utf8')
    const feature = await readFile(path.join(destination, 'src/app/app.feature.ts'), 'utf8')
    expect(application).toContain("id = 'garden'")
    expect(application).toContain('features = [AppFeature]')
    expect(application).toContain('plugins = [] as const')
    expect(feature).toContain('routes = [HomeRoute]')
    expect(feature).not.toContain('HealthRoute')
    expect(JSON.parse(await readFile(path.join(destination, 'package.json'), 'utf8'))).toEqual(
      expect.objectContaining({
        packageManager: 'pnpm@11.10.0',
        scripts: expect.objectContaining({
          dev: 'doxa dev',
          start: 'doxa serve',
          background: 'doxa work',
          work: 'doxa work',
          schedule: 'doxa schedule',
          'db:studio': 'doxa db:studio',
        }),
        engines: { node: '>=24 <25' },
      }),
    )
    expect(await readFile(path.join(destination, 'pnpm-workspace.yaml'), 'utf8')).toBe(
      `packages:\n  - .\n\nallowBuilds:\n  esbuild: true\n`,
    )
    const dockerfile = await readFile(path.join(destination, 'Dockerfile'), 'utf8')
    expect(dockerfile).toContain('FROM node:${NODE_VERSION}-bookworm-slim AS runtime')
    expect(dockerfile).toContain('RUN pnpm build')
    expect(dockerfile).toContain('RUN pnpm prune --prod')
    expect(dockerfile).toContain('USER node')
    expect(dockerfile).toContain('CMD ["doxa", "serve", "--host=0.0.0.0", "--port=3000"]')
    const productionCompose = await readFile(
      path.join(destination, 'compose.production.yaml'),
      'utf8',
    )
    expect(productionCompose).toContain('command: ["doxa", "work"]')
    expect(productionCompose).toContain('command: ["doxa", "migrate"]')
    expect(productionCompose).not.toContain('doxa schedule')
    expect(productionCompose).not.toContain('depends_on')
    expect(productionCompose).toContain('profiles: ["release"]')
    expect(await readFile(path.join(destination, '.dockerignore'), 'utf8')).toContain('.env.*')
    expect(await readFile(path.join(destination, '.env.example'), 'utf8')).toContain(
      'DATABASE_CONNECTION_STRING=',
    )
    expect(await fileExists(path.join(destination, 'src/accounts'))).toBe(false)
    expect(await fileExists(path.join(destination, 'src/infrastructure'))).toBe(false)
    expect(await fileExists(path.join(destination, 'src/tasks'))).toBe(false)
    expect(await fileExists(path.join(destination, 'src/app/http/health.route.ts'))).toBe(false)
    const generatedHome = await readFile(
      path.join(destination, 'src/app/http/home.route.ts'),
      'utf8',
    )
    expect(generatedHome).toContain('this.logger.info')
    expect(generatedHome).not.toContain('constructor(')
    await symlink(path.join(workspace, 'node_modules'), path.join(destination, 'node_modules'))
    expect(
      await runPraxis(['build'], destination, {
        out: (message) => output.push(message),
        error: (message) => errors.push(message),
      }),
    ).toBe(0)
    const generatedManifest = JSON.parse(
      await readFile(path.join(destination, '.doxa/manifest.json'), 'utf8'),
    ) as {
      applicationId: string
      buildHash: string
      plugins: Array<{ package: string }>
      features: Array<{ id: string }>
      providers: Array<{ id: string; capabilities: string[] }>
      routes: Array<{ id: string; path: string }>
    }
    expect(generatedManifest).toEqual(
      expect.objectContaining({ applicationId: 'garden', plugins: [] }),
    )
    expect(generatedManifest.features.map((entry) => entry.id)).toEqual(['app', 'doxa'])
    expect(generatedManifest.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'route:app/home', path: '/' }),
        expect.objectContaining({ id: 'route:doxa/health', path: '/health' }),
        expect.objectContaining({ id: 'route:doxa/login', path: '/auth/login' }),
      ]),
    )
    const listedRoutes: string[] = []
    expect(
      await runPraxis(['route:list'], destination, {
        out: (message) => listedRoutes.push(message),
        error: (message) => errors.push(message),
      }),
    ).toBe(0)
    expect(listedRoutes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/health'),
        expect.stringContaining('route:doxa/health'),
        expect.stringContaining('/auth/login'),
      ]),
    )
    const gnosis = JSON.parse(
      await readFile(path.join(destination, '.doxa/gnosis.json'), 'utf8'),
    ) as {
      deployment: Record<string, unknown>
    }
    expect(gnosis.deployment).toEqual(
      expect.objectContaining({
        strategy: 'one-immutable-image',
        roles: expect.objectContaining({
          web: expect.objectContaining({ command: 'doxa serve' }),
          background: expect.objectContaining({ command: 'doxa work', admitsSchedules: true }),
          migration: expect.objectContaining({ command: 'doxa migrate', automaticOnBoot: false }),
        }),
        advancedIsolation: {
          workerCommand: 'doxa work --without-scheduler',
          schedulerCommand: 'doxa schedule',
          useWhen: 'schedule admission requires independent resources or fault isolation',
        },
      }),
    )
    const manifest = generatedManifest
    const registry = (await import(
      `${pathToFileURL(path.join(destination, '.doxa/registry.mjs')).href}?buildHash=${manifest.buildHash}`
    )) as {
      constructors: Record<string, abstract new () => DoxaApplication>
    }
    const GeneratedApplication = registry.constructors['application:garden']!
    const queue = new FakeQueueManager()
    const transactions = new MemoryTransactionManager(queue)
    const harness = await DoxaTestHarness.boot(GeneratedApplication, {
      artifactsDirectory: path.join(destination, '.doxa'),
      dotenvPath: false,
      environment: { DATABASE_CONNECTION_STRING: 'generated-memory-database' },
      authProviderId: 'provider:doxa/auth',
      providerOverrides: {
        'provider:doxa/transactions': transactions,
        'provider:doxa/queues': queue,
        'provider:doxa/cache': new MemoryCache(),
        'provider:doxa/mail': new FakeMailTransport(),
        'provider:doxa/sms': new FakeSmsTransport(),
      },
    })
    try {
      const health = await harness.request('http://doxa.test/health')
      expect(health.status).toBe(200)
      expect(await health.json()).toEqual({ ok: true, data: { status: 'ok' } })
    } finally {
      await harness.shutdown()
    }
    expect(errors).toEqual([])
  })

  it('installs and wires Theoria without manual package or Feature edits', async () => {
    const root = await temporaryDirectory()
    const destination = path.join(root, 'garden')
    const messages: string[] = []
    const io = {
      out: (message: string) => messages.push(message),
      error: (message: string) => {
        throw new Error(message)
      },
    }
    expect(await runPraxis(['new', 'Garden', `--directory=${destination}`], root, io)).toBe(0)
    expect(await runPraxis(['add', 'theoria'], destination, io)).toBe(0)
    const packageJson = JSON.parse(
      await readFile(path.join(destination, 'package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>
      scripts: Record<string, string>
    }
    expect(packageJson.dependencies['@doxajs/theoria']).toBe(
      packageJson.dependencies['@doxajs/core'],
    )
    expect(packageJson.scripts).toEqual(
      expect.objectContaining({
        theoria: 'doxa theoria',
        'theoria:prune': 'doxa theoria:prune',
      }),
    )
    expect(await readFile(path.join(destination, 'app.config.ts'), 'utf8')).toContain(
      "plugins = ['@doxajs/theoria']",
    )
    expect(await fileExists(path.join(destination, 'src/infrastructure'))).toBe(false)
    expect(messages.at(-1)).toContain('Run doxa migrate, then doxa theoria')
  })

  it('fails production roles closed when prebuilt artifacts are absent', async () => {
    const root = await temporaryDirectory()
    const errors: string[] = []
    expect(
      await runPraxis(['work'], root, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(1)
    expect(errors).toEqual([
      expect.stringContaining('Prebuilt Doxa artifacts are missing or invalid. Run doxa build'),
    ])
  })

  it('plans a framework-aligned upgrade without changing a dirty application during a dry run', async () => {
    const root = await temporaryDirectory()
    const original = `${JSON.stringify(upgradeFixturePackage(), null, 2)}\n`
    await writeFile(path.join(root, 'package.json'), original)
    const output: string[] = []
    const runs: string[] = []

    expect(
      await runPraxis(['upgrade', '--to=alpha', '--dry-run'], root, {
        out: (message) => output.push(message),
        error: (message) => {
          throw new Error(message)
        },
        run: (command, args) => {
          runs.push([command, ...args].join(' '))
          return Promise.resolve(0)
        },
        capture: (_command, args) =>
          Promise.resolve(
            args[0] === 'view'
              ? registryUpgradeTarget('0.1.0-alpha.5')
              : { code: 0, stdout: ' M package.json\n', stderr: '' },
          ),
      }),
    ).toBe(0)

    expect(await readFile(path.join(root, 'package.json'), 'utf8')).toBe(original)
    expect(runs).toEqual([])
    expect(output).toContain('Doxa upgrade plan: 0.1.0-alpha.4 -> 0.1.0-alpha.5')
    expect(output).toContain('Dry run only; no files were changed.')
  })

  it('refuses a mutating upgrade in a dirty Git worktree', async () => {
    const root = await temporaryDirectory()
    await writeFile(
      path.join(root, 'package.json'),
      `${JSON.stringify(upgradeFixturePackage(), null, 2)}\n`,
    )
    const errors: string[] = []
    expect(
      await runPraxis(['upgrade', '--to=alpha'], root, {
        out: () => undefined,
        error: (message) => errors.push(message),
        run: () => Promise.resolve(0),
        capture: (_command, args) =>
          Promise.resolve(
            args[0] === 'view'
              ? registryUpgradeTarget('0.1.0-alpha.5')
              : { code: 0, stdout: ' M package.json\n', stderr: '' },
          ),
      }),
    ).toBe(1)
    expect(errors).toEqual([
      'Refusing to upgrade a dirty Git worktree. Commit or stash changes, or rerun with --force.',
    ])
  })

  it('aligns existing Doxa packages, installs them, and hands off to the upgraded Praxis', async () => {
    const root = await temporaryDirectory()
    await writeFile(
      path.join(root, 'package.json'),
      `${JSON.stringify(upgradeFixturePackage(), null, 2)}\n`,
    )
    const invocations: Array<{ command: string; args: readonly string[] }> = []
    expect(
      await runPraxis(['upgrade', '--to=0.1.0-alpha.5', '--verify'], root, {
        out: () => undefined,
        error: (message) => {
          throw new Error(message)
        },
        run: (command, args) => {
          invocations.push({ command, args })
          return Promise.resolve(0)
        },
        capture: (_command, args) =>
          Promise.resolve(
            args[0] === 'view'
              ? registryUpgradeTarget('0.1.0-alpha.5')
              : { code: 0, stdout: '', stderr: '' },
          ),
      }),
    ).toBe(0)
    const upgraded = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
      packageManager: string
    }
    expect(upgraded.dependencies).toEqual({
      '@doxajs/core': '^0.1.0-alpha.5',
      '@doxajs/praxis': '^0.1.0-alpha.5',
      hono: '^4.0.0',
    })
    expect(upgraded.devDependencies).toEqual({
      '@doxajs/testing': '^0.1.0-alpha.5',
      typescript: '^6.0.0',
    })
    expect(upgraded.packageManager).toBe('pnpm@11.10.0')
    expect(invocations.map(({ args }) => args)).toEqual([
      ['install'],
      [
        'exec',
        'doxa',
        'upgrade',
        '--continue',
        '--from=0.1.0-alpha.4',
        '--to=0.1.0-alpha.5',
        '--verify',
      ],
    ])
  })

  it('restores package.json when dependency installation fails', async () => {
    const root = await temporaryDirectory()
    const original = `${JSON.stringify(upgradeFixturePackage(), null, 2)}\n`
    await writeFile(path.join(root, 'package.json'), original)
    expect(
      await runPraxis(['upgrade', '--to=alpha'], root, {
        out: () => undefined,
        error: () => undefined,
        run: () => Promise.resolve(17),
        capture: (_command, args) =>
          Promise.resolve(
            args[0] === 'view'
              ? registryUpgradeTarget('0.1.0-alpha.5')
              : { code: 0, stdout: '', stderr: '' },
          ),
      }),
    ).toBe(1)
    expect(await readFile(path.join(root, 'package.json'), 'utf8')).toBe(original)
  })

  it('validates an installed upgrade with build, migration status, and optional tests', async () => {
    const root = await temporaryDirectory()
    const currentPraxis = JSON.parse(
      await readFile(path.join(workspace, 'packages/praxis/package.json'), 'utf8'),
    ) as { version: string }
    await writeFile(
      path.join(root, 'package.json'),
      `${JSON.stringify(upgradeFixturePackage(currentPraxis.version), null, 2)}\n`,
    )
    const invocations: string[][] = []
    expect(
      await runPraxis(
        [
          'upgrade',
          '--continue',
          '--from=0.1.0-alpha.0',
          `--to=${currentPraxis.version}`,
          '--verify',
        ],
        root,
        {
          out: () => undefined,
          error: (message) => {
            throw new Error(message)
          },
          run: (_command, args) => {
            invocations.push([...args])
            return Promise.resolve(0)
          },
        },
      ),
    ).toBe(0)
    expect(invocations).toEqual([
      ['exec', 'doxa', 'build'],
      ['exec', 'doxa', 'migrate:status'],
      ['test'],
    ])
  })

  it('installs optional plugins through package metadata and app.config.ts only', async () => {
    const root = await temporaryDirectory()
    const destination = path.join(root, 'garden')
    const errors: string[] = []
    expect(
      await runPraxis(['new', 'Garden', `--directory=${destination}`], root, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(0)
    expect(
      await runPraxis(['add', 'sendgrid'], destination, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(0)
    const packageJson = JSON.parse(
      await readFile(path.join(destination, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> }
    expect(packageJson.dependencies['@doxajs/sendgrid']).toBe(
      packageJson.dependencies['@doxajs/core'],
    )
    expect(await readFile(path.join(destination, 'app.config.ts'), 'utf8')).toContain(
      "plugins = ['@doxajs/sendgrid'] as const",
    )
    expect(await fileExists(path.join(destination, 'src/infrastructure'))).toBe(false)
    await symlink(path.join(workspace, 'node_modules'), path.join(destination, 'node_modules'))
    expect(
      await runPraxis(['build'], destination, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(0)
    const manifest = JSON.parse(
      await readFile(path.join(destination, '.doxa/manifest.json'), 'utf8'),
    ) as { plugins: Array<{ package: string }> }
    expect(manifest.plugins).toEqual([expect.objectContaining({ package: '@doxajs/sendgrid' })])
    expect(errors).toEqual([])
  })
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'doxa-praxis-'))
  directories.push(directory)
  return directory
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

function upgradeFixturePackage(version = '0.1.0-alpha.4'): Record<string, unknown> {
  return {
    name: 'upgrade-fixture',
    private: true,
    packageManager: 'pnpm@10.0.0',
    engines: { node: '>=22' },
    dependencies: {
      '@doxajs/core': `^${version}`,
      '@doxajs/praxis': `^${version}`,
      hono: '^4.0.0',
    },
    devDependencies: {
      '@doxajs/testing': `^${version}`,
      typescript: '^5.0.0',
    },
  }
}

function registryUpgradeTarget(version: string): { code: number; stdout: string; stderr: string } {
  return {
    code: 0,
    stdout: JSON.stringify({
      version,
      doxaCompatibility: {
        schemaVersion: 1,
        channel: 'alpha',
        frameworkPackages: ['@doxajs/core', '@doxajs/praxis', '@doxajs/testing'],
        toolchain: {
          node: '>=24 <25',
          packageManager: 'pnpm@11.10.0',
          devDependencies: {
            '@types/node': '^24.0.0',
            typescript: '^6.0.0',
            vitest: '^4.0.0',
          },
        },
        upgradeRecipes: [],
      },
    }),
    stderr: '',
  }
}

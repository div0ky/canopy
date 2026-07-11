import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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
  MemoryTelemetry,
  MemoryTransactionManager,
} from '@canopy/testing'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []
const workspace = path.resolve(import.meta.dirname, '..')

describe('Arbor command suite', () => {
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('generates a Feature and registers generated model and action declarations', async () => {
    const root = await temporaryDirectory()
    const output: string[] = []
    const errors: string[] = []
    const io = { out: (message: string) => output.push(message), error: (message: string) => errors.push(message) }

    expect(await runArbor(['make:feature', 'Accounts'], root, io)).toBe(0)
    expect(await runArbor(['make:model', 'Accounts/User'], root, io)).toBe(0)
    expect(await runArbor(['make:action', 'Accounts/RegisterUser', '--ability=accounts.register'], root, io)).toBe(0)

    const feature = await readFile(path.join(root, 'src/accounts/accounts.feature.ts'), 'utf8')
    expect(feature).toContain("import { User } from './models/user.js'")
    expect(feature).toContain("import { RegisterUser } from './actions/register-user.js'")
    expect(feature).toContain('models = [User]')
    expect(feature).toContain('actions = [RegisterUser]')
    expect(await readFile(path.join(root, 'src/accounts/actions/register-user.ts'), 'utf8'))
      .toContain("static override readonly access = 'accounts.register'")
    expect(errors).toEqual([])
  })

  it('fails closed when an operation generator omits its authorization posture', async () => {
    const root = await temporaryDirectory()
    const errors: string[] = []
    await runArbor(['make:feature', 'Accounts'], root, { out: () => undefined, error: () => undefined })
    expect(await runArbor(['make:action', 'Accounts/RegisterUser'], root, {
      out: () => undefined,
      error: (message) => errors.push(message),
    })).toBe(1)
    expect(errors).toEqual(['Framework entry roles require --public or --ability=<stable ability>.'])
  })

  it('generates and registers every canonical framework role', async () => {
    const root = await temporaryDirectory()
    const io = { out: () => undefined, error: (message: string) => { throw new Error(message) } }
    await runArbor(['make:feature', 'Commerce'], root, io)
    const commands = [
      ['make:model', 'Commerce/Order'],
      ['make:event', 'Commerce/OrderPlaced'],
      ['make:listener', 'Commerce/NotifyWarehouse', '--event=OrderPlaced', '--queued-after-commit', '--public'],
      ['make:signal', 'Commerce/OrderTouched'],
      ['make:signal-handler', 'Commerce/RecordOrderTouched', '--signal=OrderTouched', '--public'],
      ['make:observer', 'Commerce/OrderObserver', '--model=Order'],
      ['make:job', 'Commerce/ShipOrder', '--ability=orders.ship'],
      ['make:schedule', 'Commerce/ShipPendingOrders', '--job=ShipOrder', '--every=60', '--public'],
      ['make:policy', 'Commerce/OrderPolicy', '--abilities=orders.view,orders.ship'],
      ['make:route', 'Commerce/ListOrdersRoute', '--method=GET', '--path=/orders', '--ability=orders.view'],
      ['make:config', 'Commerce/CommerceConfig'],
      ['make:provider', 'Commerce/WarehouseProvider'],
      ['make:service', 'Commerce/CalculateOrderTotal'],
      ['make:command', 'Commerce/RebuildProjections', '--name=commerce:rebuild-projections', '--public'],
    ]
    for (const command of commands) expect(await runArbor(command, root, io)).toBe(0)
    const feature = await readFile(path.join(root, 'src/commerce/commerce.feature.ts'), 'utf8')
    for (const field of ['models', 'events', 'listeners', 'signals', 'signalHandlers', 'observers', 'jobs', 'schedules', 'policies', 'routes', 'configs', 'providers', 'commands']) {
      expect(feature).toContain(`${field} = [`)
    }
    expect(feature).not.toContain('services =')
    expect(await readFile(path.join(root, 'src/commerce/listeners/notify-warehouse.ts'), 'utf8')).toContain('implements ShouldQueueAfterCommit')
    expect(await readFile(path.join(root, 'src/commerce/schedules/ship-pending-orders.ts'), 'utf8')).toContain('everySeconds = 60')
    expect(await readFile(path.join(root, 'src/commerce/policies/order-policy.ts'), 'utf8')).toContain('orders.ship')
  })

  it('registers new Features in an existing Application and creates migrations and tests', async () => {
    const root = await temporaryDirectory()
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src/application.ts'), "import { CanopyApplication } from '@canopy/core'\n\nexport class Application extends CanopyApplication {\n  id = 'fixture'\n  features = []\n}\n")
    const io = { out: () => undefined, error: (message: string) => { throw new Error(message) } }
    expect(await runArbor(['make:feature', 'Accounts'], root, io)).toBe(0)
    expect(await readFile(path.join(root, 'src/application.ts'), 'utf8')).toContain('features = [AccountsFeature]')
    expect(await runArbor(['make:migration', 'create orders'], root, io)).toBe(0)
    expect(await runArbor(['make:test', 'Accounts/RegisterUser'], root, io)).toBe(0)
    expect((await readFile(path.join(root, 'tests/accounts/register-user.test.ts'), 'utf8'))).toContain("describe('RegisterUser'")
  })

  it('creates an opinionated runnable application skeleton in a clean directory', async () => {
    const root = await temporaryDirectory()
    const destination = path.join(root, 'garden')
    const output: string[] = []
    const errors: string[] = []
    expect(await runArbor(['new', 'Garden', `--directory=${destination}`], root, {
      out: () => undefined,
      error: (message) => errors.push(message),
    })).toBe(0)
    const application = await readFile(path.join(destination, 'src/application.ts'), 'utf8')
    const feature = await readFile(path.join(destination, 'src/app/app.feature.ts'), 'utf8')
    expect(application).toContain("id = 'garden'")
    expect(application).toContain('features = [InfrastructureFeature, AccountsFeature, TasksFeature, AppFeature]')
    expect(feature).toContain('routes = [HomeRoute, HealthRoute]')
    expect(JSON.parse(await readFile(path.join(destination, 'package.json'), 'utf8'))).toEqual(expect.objectContaining({
      scripts: expect.objectContaining({ dev: 'arbor dev', work: 'arbor work', schedule: 'arbor schedule' }),
      engines: { node: '>=24 <25' },
    }))
    expect(await readFile(path.join(destination, '.env.example'), 'utf8')).toContain('DATABASE_CONNECTION_STRING=')
    expect(await readFile(path.join(destination, 'src/accounts/accounts.feature.ts'), 'utf8')).toContain('TokenRoute')
    expect(await readFile(path.join(destination, 'src/infrastructure/infrastructure.feature.ts'), 'utf8')).toContain('ApplicationAuth')
    expect(await readFile(path.join(destination, 'src/tasks/tasks.feature.ts'), 'utf8')).toContain('schedules = [ProcessTasks]')
    await symlink(path.join(workspace, 'node_modules'), path.join(destination, 'node_modules'))
    expect(await runArbor(['build'], destination, {
      out: (message) => output.push(message),
      error: (message) => errors.push(message),
    })).toBe(0)
    expect(JSON.parse(await readFile(path.join(destination, '.canopy/manifest.json'), 'utf8')))
      .toEqual(expect.objectContaining({ applicationId: 'garden' }))
    const manifest = JSON.parse(await readFile(path.join(destination, '.canopy/manifest.json'), 'utf8')) as { buildHash: string }
    const registry = await import(`${pathToFileURL(path.join(destination, '.canopy/registry.mjs')).href}?buildHash=${manifest.buildHash}`) as {
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
        'provider:infrastructure/telemetry': new MemoryTelemetry(),
      },
    })
    try {
      harness.actingAsUser('generated-user')
      const completed = await harness.request('http://canopy.test/tasks/generated-task/complete', { method: 'POST' })
      expect(completed.status).toBe(200)
      expect(await completed.json()).toEqual(expect.objectContaining({ id: 'generated-task', completed: true }))
      expect(transactions.state.entities.get('model:tasks/task/generated-task')).toEqual(expect.objectContaining({ version: 1 }))
      expect(transactions.state.journal).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'task.completed' })]))
      expect(queue.hasQueued('process-task')).toBe(true)
      while (queue.queued.length > 0) await queue.runNext()
      expect(mail.sent).toHaveLength(1)
      expect(sms.sent).toHaveLength(1)
      await queue.runSchedule('schedule:tasks/process-tasks')
    } finally { await harness.shutdown() }
    expect(errors).toEqual([])
  })
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'canopy-arbor-'))
  directories.push(directory)
  return directory
}

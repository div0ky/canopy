import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { compileApplication } from '@doxajs/compiler'
import {
  Channel,
  FakeBroadcastTransport,
  PrivateChannel,
  type BroadcastGateway,
  type BroadcastMessage,
} from '@doxajs/core'
import { Keryx } from '@doxajs/keryx'
import { Realtime, type RealtimeSocket } from '@doxajs/realtime'
import {
  DoxaTestHarness,
  FakeQueueManager,
  MemoryCache,
  MemoryTelemetry,
  MemoryTransactionManager,
} from '@doxajs/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Application } from '../examples/persistence-app/dist/application.js'
import { BroadcastCounter } from '../examples/persistence-app/dist/counters/actions/broadcast-counter.js'
import { CounterBroadcasted } from '../examples/persistence-app/dist/counters/events/counter-broadcasted.js'
import { CounterBroadcastedNow } from '../examples/persistence-app/dist/counters/events/counter-broadcasted-now.js'

const workspace = path.resolve(import.meta.dirname, '..')
const applicationRoot = path.join(workspace, 'examples/persistence-app')
let artifacts: string

describe('Doxa broadcasting', () => {
  beforeAll(async () => {
    artifacts = await mkdtemp(path.join(tmpdir(), 'doxa-broadcasting-'))
    await compileApplication({
      tsconfigPath: path.join(applicationRoot, 'tsconfig.json'),
      applicationFile: path.join(applicationRoot, 'src/application.ts'),
      sourceRoot: path.join(applicationRoot, 'src'),
      outputRoot: path.join(applicationRoot, 'dist'),
      artifactsDirectory: artifacts,
    })
  })

  afterAll(async () => {
    await rm(artifacts, { recursive: true, force: true })
  })

  it('compiles queued and synchronous capabilities into manifest facts', async () => {
    const result = await compileApplication({
      tsconfigPath: path.join(applicationRoot, 'tsconfig.json'),
      applicationFile: path.join(applicationRoot, 'src/application.ts'),
      sourceRoot: path.join(applicationRoot, 'src'),
      outputRoot: path.join(applicationRoot, 'dist'),
      artifactsDirectory: artifacts,
    })
    expect(result.manifest.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'event:counters/counter-broadcasted',
          broadcast: 'queued',
        }),
        expect.objectContaining({
          id: 'event:counters/counter-broadcasted-now',
          broadcast: 'now',
        }),
      ]),
    )
    expect(
      result.manifest.providers.find((provider) => provider.capabilities.includes('broadcasting')),
    ).toEqual(expect.objectContaining({ id: 'provider:infrastructure/broadcasting' }))
  })

  it('fails compilation when broadcast subscription policy is absent', async () => {
    const root = await mkdtemp(path.join(workspace, '.broadcast-fixture-'))
    try {
      await mkdir(path.join(root, 'src'))
      await writeFile(
        path.join(root, 'tsconfig.json'),
        JSON.stringify({
          extends: '../tsconfig.base.json',
          compilerOptions: {
            composite: false,
            rootDir: 'src',
            outDir: 'dist',
            declaration: false,
            declarationMap: false,
          },
          include: ['src/**/*.ts'],
        }),
      )
      await writeFile(
        path.join(root, 'src/application.ts'),
        `import { Channel, DoxaApplication, Event, FakeBroadcastTransport, Feature, type ShouldBroadcastNow } from '@doxajs/core'
class Broadcasts extends FakeBroadcastTransport { static readonly id = 'broadcasting' }
class Happened extends Event implements ShouldBroadcastNow {
  static override readonly id = 'happened'
  broadcastOn() { return new Channel('public.events') }
}
class AppFeature extends Feature { id = 'app'; providers = [Broadcasts]; events = [Happened] }
export class Application extends DoxaApplication { id = 'broadcast-fixture'; features = [AppFeature] }
`,
      )
      await expect(
        compileApplication({
          tsconfigPath: path.join(root, 'tsconfig.json'),
          applicationFile: path.join(root, 'src/application.ts'),
          sourceRoot: path.join(root, 'src'),
          outputRoot: path.join(root, 'dist'),
          artifactsDirectory: path.join(root, '.doxa'),
        }),
      ).rejects.toThrow('broadcast.subscribe ability')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('publishes now, queues durable broadcasts, and authorizes private subscriptions', async () => {
    const queue = new FakeQueueManager()
    const broadcasts = new FakeBroadcastTransport()
    const harness = await DoxaTestHarness.boot(Application, {
      artifactsDirectory: artifacts,
      dotenvPath: false,
      environment: { DATABASE_CONNECTION_STRING: 'test-memory-database' },
      authProviderId: 'provider:infrastructure/auth',
      providerOverrides: {
        'provider:infrastructure/transactions': new MemoryTransactionManager(queue),
        'provider:infrastructure/queues': queue,
        'provider:infrastructure/cache': new MemoryCache(),
        'provider:infrastructure/telemetry': new MemoryTelemetry(),
        'provider:infrastructure/broadcasting': broadcasts,
      },
    })
    try {
      harness.actingAsUser('ada')
      await harness.event(CounterBroadcastedNow, { counterId: 'counter-1' })
      expect(broadcasts.published).toEqual([
        expect.objectContaining({
          event: 'event:counters/counter-broadcasted-now',
          channels: [{ kind: 'public', name: 'counters.public' }],
          data: { id: 'counter-1' },
        }),
      ])

      await harness.event(CounterBroadcasted, { counterId: 'counter-1', value: 7 })
      expect(queue.queued).toEqual([
        expect.objectContaining({
          kind: 'broadcast',
          targetId: 'event:counters/counter-broadcasted',
        }),
      ])
      await queue.runNext()
      expect(broadcasts.published[1]).toEqual(
        expect.objectContaining({
          event: 'counter.updated',
          data: { counterId: 'counter-1', value: 7 },
          channels: [
            { kind: 'private', name: 'counters.counter-1' },
            { kind: 'presence', name: 'counters.online' },
          ],
        }),
      )

      const beforeTransaction = queue.queued.length
      await harness.action(BroadcastCounter, { counterId: 'counter-2', value: 8 })
      expect(queue.queued).toHaveLength(beforeTransaction + 1)
      await expect(
        harness.action(BroadcastCounter, { counterId: 'counter-3', value: 9, fail: true }),
      ).rejects.toThrow('Broadcast transaction rolled back')
      expect(queue.queued).toHaveLength(beforeTransaction + 1)

      const admission = await broadcasts.connect('connection-1', new Request('http://doxa.test'))
      await expect(
        broadcasts.subscribe(admission, new PrivateChannel('counters.counter-1')),
      ).resolves.toEqual({})
      await expect(
        broadcasts.subscribe(admission, new PrivateChannel('secrets.counter-1')),
      ).rejects.toThrow('not authorized')
    } finally {
      await harness.shutdown()
    }
  })

  it('delivers through Keryx and the reconnecting subscriber protocol', async () => {
    let subscribed = false
    let connectionCount = 0
    const gateway: BroadcastGateway = {
      connect: async (connectionId) => {
        const identityId = connectionCount++ === 0 ? 'ada' : 'grace'
        return {
          connectionId,
          actor: { kind: 'user', id: identityId },
          authentication: { state: 'authenticated', identityId },
          correlationId: 'connection-correlation',
        }
      },
      subscribe: async (admission, destination) => {
        subscribed = true
        return destination.kind === 'presence' ? { member: admission.actor } : {}
      },
      unsubscribe: async () => undefined,
    }
    const keryx = new Keryx({ port: 0, heartbeatMilliseconds: 50 })
    keryx.bind(gateway)
    const lifecycle = {
      signal: new AbortController().signal,
      deadline: new Date(Date.now() + 2_000),
    }
    await keryx.start(lifecycle)
    const received: unknown[] = []
    const here: unknown[] = []
    const joining: unknown[] = []
    const leaving: unknown[] = []
    const realtime = new Realtime({
      url: `ws://${keryx.address.host}:${keryx.address.port}${keryx.address.path}`,
      reconnectMinimumMilliseconds: 10,
    })
    realtime
      .channel<{ 'counter.changed': { value: number } }>('counters.public')
      .listen('counter.changed', (data) => received.push(data))
    try {
      await waitFor(() => subscribed)
      const message: BroadcastMessage = {
        id: 'message-1',
        event: 'counter.changed',
        channels: [new Channel('counters.public')],
        data: { value: 9 },
        occurredAt: new Date().toISOString(),
      }
      await keryx.publish(message)
      await waitFor(() => received.length === 1)
      expect(received).toEqual([{ value: 9 }])

      realtime
        .presence('counters.online')
        .here((members) => here.push(members))
        .joining((member) => joining.push(member))
        .leaving((member) => leaving.push(member))
      await waitFor(() => here.length === 1)
      const second = new Realtime({
        url: `ws://${keryx.address.host}:${keryx.address.port}${keryx.address.path}`,
      })
      const secondPresence = second
        .presence('counters.online')
        .here((members) => here.push(members))
      try {
        await waitFor(() => here.length === 2 && joining.length === 1)
        expect(here[1]).toEqual([
          { kind: 'user', id: 'ada' },
          { kind: 'user', id: 'grace' },
        ])
        expect(joining).toEqual([{ kind: 'user', id: 'grace' }])
        secondPresence.leave()
        await waitFor(() => leaving.length === 1)
        expect(leaving).toEqual([{ kind: 'user', id: 'grace' }])
      } finally {
        second.disconnect()
      }
    } finally {
      realtime.disconnect()
      await keryx.drain(lifecycle)
      await keryx.stop(lifecycle)
      keryx.dispose(lifecycle)
    }
  })

  it('resubscribes active channels after reconnect and stops after explicit disconnect', async () => {
    const sockets: TestSocket[] = []
    const realtime = new Realtime({
      url: 'ws://doxa.test/app',
      reconnectMinimumMilliseconds: 1,
      reconnectMaximumMilliseconds: 1,
      socketFactory: () => {
        const socket = new TestSocket()
        sockets.push(socket)
        return socket
      },
    })
    realtime.private('counters.ada')
    sockets[0]!.open()
    expect(sockets[0]!.sent).toEqual([
      JSON.stringify({
        protocol: 1,
        type: 'subscribe',
        channel: { name: 'counters.ada', kind: 'private' },
      }),
    ])

    sockets[0]!.drop()
    await waitFor(() => sockets.length === 2)
    sockets[1]!.open()
    expect(sockets[1]!.sent).toEqual(sockets[0]!.sent)

    realtime.disconnect()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(sockets).toHaveLength(2)
  })
})

async function waitFor(assertion: () => boolean, timeout = 2_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!assertion()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for realtime state.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

class TestSocket implements RealtimeSocket {
  readyState = 0
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: { readonly data: unknown }) => void) | null = null
  onclose: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  readonly sent: string[] = []

  open(): void {
    this.readyState = 1
    this.onopen?.({})
  }

  drop(): void {
    this.readyState = 3
    this.onclose?.({})
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = 3
  }
}

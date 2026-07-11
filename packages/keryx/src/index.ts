import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'

import {
  BroadcastTransport,
  type BroadcastConnectionAdmission,
  type BroadcastDestination,
  type BroadcastGateway,
  type BroadcastMessage,
  type Disposes,
  type Drains,
  type LifecycleContext,
  type Starts,
  type Stops,
  validateBroadcastChannelName,
} from '@doxajs/core'
import WebSocket, { WebSocketServer } from 'ws'

const PROTOCOL = 1

export interface KeryxOptions {
  readonly port?: number
  readonly host?: string
  readonly path?: string
  readonly maxPayloadBytes?: number
  readonly heartbeatMilliseconds?: number
  readonly maxBufferedBytes?: number
}

interface Connection {
  readonly id: string
  readonly socket: WebSocket
  readonly admission: BroadcastConnectionAdmission
  readonly subscriptions: Map<string, BroadcastDestination>
  alive: boolean
  inbound: Promise<void>
}

type ClientFrame =
  | { readonly protocol: 1; readonly type: 'subscribe'; readonly channel: BroadcastDestination }
  | { readonly protocol: 1; readonly type: 'unsubscribe'; readonly channel: BroadcastDestination }
  | { readonly protocol: 1; readonly type: 'ping'; readonly id?: string }

export class Keryx extends BroadcastTransport implements Starts, Drains, Stops, Disposes {
  static readonly id = 'broadcasting'
  #gateway?: BroadcastGateway
  #server: Server | undefined
  #webSockets: WebSocketServer | undefined
  #heartbeat: NodeJS.Timeout | undefined
  #connections = new Set<Connection>()
  #publishing = new Set<Promise<void>>()
  #draining = false
  readonly #options: Required<KeryxOptions>

  constructor(options: KeryxOptions = {}) {
    super()
    const path = options.path ?? '/app'
    if (!path.startsWith('/')) throw new TypeError('Keryx path must begin with /.')
    this.#options = {
      port: options.port ?? 6001,
      host: options.host ?? '127.0.0.1',
      path,
      maxPayloadBytes: options.maxPayloadBytes ?? 64 * 1024,
      heartbeatMilliseconds: options.heartbeatMilliseconds ?? 30_000,
      maxBufferedBytes: options.maxBufferedBytes ?? 1024 * 1024,
    }
  }

  bind(gateway: BroadcastGateway): void {
    if (this.#gateway) throw new Error('Keryx is already bound to a Doxa runtime.')
    if (this.#server) throw new Error('Keryx must be bound before it starts.')
    this.#gateway = gateway
  }

  async start(context: LifecycleContext): Promise<void> {
    if (context.signal.aborted) throw context.signal.reason
    if (!this.#gateway) throw new Error('The Doxa runtime did not bind Keryx.')
    if (this.#server) throw new Error('Keryx is already started.')
    const server = createServer((_request, response) => {
      response.writeHead(404).end()
    })
    const webSockets = new WebSocketServer({
      server,
      path: this.#options.path,
      maxPayload: this.#options.maxPayloadBytes,
      perMessageDeflate: false,
    })
    webSockets.on('connection', (socket, request) => void this.#accept(socket, request))
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error): void => reject(error)
      server.once('error', failed)
      server.listen(this.#options.port, this.#options.host, () => {
        server.off('error', failed)
        resolve()
      })
    })
    this.#server = server
    this.#webSockets = webSockets
    this.#heartbeat = setInterval(() => this.#pulse(), this.#options.heartbeatMilliseconds)
    this.#heartbeat.unref()
  }

  async publish(message: BroadcastMessage): Promise<void> {
    if (!this.#webSockets || this.#draining) throw new Error('Keryx is not accepting broadcasts.')
    const work = this.#publish(message)
    this.#publishing.add(work)
    try {
      await work
    } finally {
      this.#publishing.delete(work)
    }
  }

  async drain(_context: LifecycleContext): Promise<void> {
    this.#draining = true
    this.#webSockets?.close()
    await Promise.allSettled([...this.#publishing])
  }

  async stop(_context: LifecycleContext): Promise<void> {
    if (this.#heartbeat) clearInterval(this.#heartbeat)
    this.#heartbeat = undefined
    for (const connection of this.#connections) connection.socket.close(1001, 'Server shutdown')
    await new Promise<void>((resolve) => {
      const server = this.#server
      if (!server?.listening) return resolve()
      server.close(() => resolve())
    })
    this.#server = undefined
    this.#webSockets = undefined
  }

  dispose(_context: LifecycleContext): void {
    for (const connection of this.#connections) connection.socket.terminate()
    this.#connections.clear()
  }

  get address(): { readonly host: string; readonly port: number; readonly path: string } {
    const address = this.#server?.address()
    return {
      host: this.#options.host,
      port: typeof address === 'object' && address ? address.port : this.#options.port,
      path: this.#options.path,
    }
  }

  async #accept(socket: WebSocket, incoming: IncomingMessage): Promise<void> {
    const id = randomUUID()
    try {
      const admission = await this.#gateway!.connect(id, requestFromIncoming(incoming))
      if (socket.readyState !== WebSocket.OPEN) return
      const connection: Connection = {
        id,
        socket,
        admission,
        subscriptions: new Map(),
        alive: true,
        inbound: Promise.resolve(),
      }
      this.#connections.add(connection)
      socket.on('pong', () => (connection.alive = true))
      socket.on('message', (data, binary) => {
        connection.inbound = connection.inbound
          .then(() => this.#receive(connection, data, binary))
          .catch(() => this.#reject(connection, 'message_failed', false))
      })
      socket.once('close', () => void this.#disconnect(connection))
      socket.once('error', () => undefined)
      this.#send(socket, { protocol: PROTOCOL, type: 'connected', connectionId: id })
    } catch {
      socket.close(4401, 'Connection admission failed')
    }
  }

  async #receive(connection: Connection, data: WebSocket.RawData, binary: boolean): Promise<void> {
    if (binary) return this.#reject(connection, 'binary_not_supported', true)
    let frame: ClientFrame
    try {
      frame = parseClientFrame(data.toString())
    } catch {
      return this.#reject(connection, 'invalid_frame', false)
    }
    try {
      if (frame.type === 'ping') {
        this.#send(connection.socket, { protocol: PROTOCOL, type: 'pong', id: frame.id })
        return
      }
      const destination = normalizeDestination(frame.channel)
      const key = destinationKey(destination)
      if (frame.type === 'subscribe') {
        if (connection.subscriptions.has(key)) return
        const result = await this.#gateway!.subscribe(connection.admission, destination)
        const alreadyPresent = result.member ? this.#hasPresenceMember(key, result.member) : false
        const members =
          destination.kind === 'presence' ? this.#presenceMembers(key, result.member) : undefined
        connection.subscriptions.set(key, destination)
        this.#send(connection.socket, {
          protocol: PROTOCOL,
          type: 'subscribed',
          channel: destination,
          ...(members ? { members } : {}),
        })
        if (result.member && !alreadyPresent)
          this.#broadcastPresence(connection, key, destination, 'presence_joined', result.member)
        return
      }
      await this.#leave(connection, destination)
      this.#send(connection.socket, {
        protocol: PROTOCOL,
        type: 'unsubscribed',
        channel: destination,
      })
    } catch {
      this.#reject(connection, 'subscription_denied', false)
    }
  }

  async #leave(connection: Connection, destination: BroadcastDestination): Promise<void> {
    const key = destinationKey(destination)
    if (!connection.subscriptions.delete(key)) return
    await this.#gateway!.unsubscribe(connection.admission, destination)
    if (
      destination.kind === 'presence' &&
      !this.#hasPresenceMember(key, connection.admission.actor)
    )
      this.#broadcastPresence(
        connection,
        key,
        destination,
        'presence_left',
        connection.admission.actor,
      )
  }

  async #disconnect(connection: Connection): Promise<void> {
    if (!this.#connections.delete(connection)) return
    for (const destination of [...connection.subscriptions.values()]) {
      await this.#leave(connection, destination).catch(() => undefined)
    }
  }

  async #publish(message: BroadcastMessage): Promise<void> {
    const serializedByChannel = new Map<string, string>()
    for (const connection of this.#connections) {
      for (const channel of message.channels) {
        const key = destinationKey(channel)
        if (!connection.subscriptions.has(key)) continue
        if (connection.socket.bufferedAmount > this.#options.maxBufferedBytes) {
          connection.socket.close(4408, 'Subscriber is too slow')
          break
        }
        const serialized =
          serializedByChannel.get(key) ??
          JSON.stringify({
            protocol: PROTOCOL,
            type: 'event',
            id: message.id,
            event: message.event,
            channel,
            data: message.data,
            occurredAt: message.occurredAt,
          })
        serializedByChannel.set(key, serialized)
        try {
          connection.socket.send(serialized)
        } catch {
          connection.socket.terminate()
        }
      }
    }
  }

  #presenceMembers(key: string, joining?: BroadcastConnectionAdmission['actor']) {
    const members = new Map<string, BroadcastConnectionAdmission['actor']>()
    for (const connection of this.#connections) {
      if (connection.subscriptions.has(key))
        members.set(actorKey(connection.admission.actor), connection.admission.actor)
    }
    if (joining) members.set(actorKey(joining), joining)
    return [...members.values()]
  }

  #hasPresenceMember(key: string, actor: BroadcastConnectionAdmission['actor']): boolean {
    const member = actorKey(actor)
    for (const connection of this.#connections) {
      if (connection.subscriptions.has(key) && actorKey(connection.admission.actor) === member)
        return true
    }
    return false
  }

  #broadcastPresence(
    source: Connection,
    key: string,
    destination: BroadcastDestination,
    type: 'presence_joined' | 'presence_left',
    member: BroadcastConnectionAdmission['actor'],
  ): void {
    for (const connection of this.#connections) {
      if (connection !== source && connection.subscriptions.has(key))
        this.#send(connection.socket, { protocol: PROTOCOL, type, channel: destination, member })
    }
  }

  #pulse(): void {
    for (const connection of this.#connections) {
      if (!connection.alive) {
        connection.socket.terminate()
        continue
      }
      connection.alive = false
      connection.socket.ping()
    }
  }

  #reject(connection: Connection, code: string, close: boolean): void {
    this.#send(connection.socket, { protocol: PROTOCOL, type: 'error', code })
    if (close) connection.socket.close(4400, code)
  }

  #send(socket: WebSocket, frame: unknown): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame))
  }
}

function parseClientFrame(value: string): ClientFrame {
  const frame = JSON.parse(value) as Record<string, unknown>
  if (
    frame.protocol !== PROTOCOL ||
    !['subscribe', 'unsubscribe', 'ping'].includes(String(frame.type))
  )
    throw new TypeError('Unsupported Keryx frame.')
  if (frame.type === 'ping')
    return {
      protocol: PROTOCOL,
      type: 'ping',
      ...(typeof frame.id === 'string' ? { id: frame.id } : {}),
    }
  if (!frame.channel || typeof frame.channel !== 'object')
    throw new TypeError('Channel is required.')
  return {
    protocol: PROTOCOL,
    type: frame.type as 'subscribe' | 'unsubscribe',
    channel: frame.channel as BroadcastDestination,
  }
}

function normalizeDestination(destination: BroadcastDestination): BroadcastDestination {
  if (!['public', 'private', 'presence'].includes(destination.kind))
    throw new TypeError('Invalid channel kind.')
  return Object.freeze({
    name: validateBroadcastChannelName(destination.name),
    kind: destination.kind,
  })
}

function destinationKey(destination: BroadcastDestination): string {
  return `${destination.kind}:${destination.name}`
}

function actorKey(actor: BroadcastConnectionAdmission['actor']): string {
  return `${actor.kind}:${actor.id ?? ''}`
}

function requestFromIncoming(incoming: IncomingMessage): Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item)
    else if (value !== undefined) headers.set(name, value)
  }
  return new Request(`http://${incoming.headers.host ?? 'localhost'}${incoming.url ?? '/'}`, {
    headers,
  })
}

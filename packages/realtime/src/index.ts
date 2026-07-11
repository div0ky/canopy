const PROTOCOL = 1

export type RealtimeEventMap = Readonly<Record<string, unknown>>
export type RealtimeChannelKind = 'public' | 'private' | 'presence'

export interface RealtimeSocket {
  readonly readyState: number
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { readonly data: unknown }) => void) | null
  onclose: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
  send(data: string): void
  close(code?: number, reason?: string): void
}

export type RealtimeSocketFactory = (
  url: string,
  protocols?: string | readonly string[],
) => RealtimeSocket

export interface RealtimeOptions {
  readonly url: string
  readonly protocols?: string | readonly string[]
  readonly socketFactory?: RealtimeSocketFactory
  readonly reconnect?: boolean
  readonly reconnectMinimumMilliseconds?: number
  readonly reconnectMaximumMilliseconds?: number
}

export type RealtimeListener = (data: unknown, frame: RealtimeEventFrame) => void
export type RealtimeMember = Readonly<{ kind: string; id?: string }>

export interface RealtimeEventFrame {
  readonly id: string
  readonly event: string
  readonly channel: { readonly name: string; readonly kind: RealtimeChannelKind }
  readonly data: unknown
  readonly occurredAt: string
}

export class Subscription<Events extends RealtimeEventMap = RealtimeEventMap> {
  readonly #listeners = new Map<string, Set<RealtimeListener>>()
  readonly #here = new Set<(members: readonly RealtimeMember[]) => void>()
  readonly #joining = new Set<(member: RealtimeMember) => void>()
  readonly #leaving = new Set<(member: RealtimeMember) => void>()

  constructor(
    private readonly owner: Realtime,
    readonly name: string,
    readonly kind: RealtimeChannelKind,
  ) {}

  listen<Name extends keyof Events & string>(
    event: Name,
    listener: (data: Events[Name], frame: RealtimeEventFrame) => void,
  ): this {
    const listeners = this.#listeners.get(event) ?? new Set<RealtimeListener>()
    listeners.add(listener as RealtimeListener)
    this.#listeners.set(event, listeners)
    return this
  }

  stopListening<Name extends keyof Events & string>(
    event: Name,
    listener?: RealtimeListener,
  ): this {
    if (listener) this.#listeners.get(event)?.delete(listener)
    else this.#listeners.delete(event)
    if (
      [...this.#listeners.values()].every((listeners) => listeners.size === 0) &&
      this.#here.size === 0 &&
      this.#joining.size === 0 &&
      this.#leaving.size === 0
    )
      this.leave()
    return this
  }

  here(listener: (members: readonly RealtimeMember[]) => void): this {
    this.#here.add(listener)
    return this
  }

  joining(listener: (member: RealtimeMember) => void): this {
    this.#joining.add(listener)
    return this
  }

  leaving(listener: (member: RealtimeMember) => void): this {
    this.#leaving.add(listener)
    return this
  }

  leave(): void {
    this.owner.leave(this.name, this.kind)
  }

  dispatch(frame: RealtimeEventFrame): void {
    for (const listener of this.#listeners.get(frame.event) ?? []) listener(frame.data, frame)
  }

  presence(type: 'subscribed' | 'presence_joined' | 'presence_left', value: unknown): void {
    if (type === 'subscribed' && Array.isArray(value))
      for (const listener of this.#here) listener(value as RealtimeMember[])
    if (type === 'presence_joined' && isMember(value))
      for (const listener of this.#joining) listener(value)
    if (type === 'presence_left' && isMember(value))
      for (const listener of this.#leaving) listener(value)
  }
}

export class Realtime {
  readonly #options: Required<Omit<RealtimeOptions, 'protocols' | 'socketFactory'>> &
    Pick<RealtimeOptions, 'protocols'>
  readonly #factory: RealtimeSocketFactory
  readonly #subscriptions = new Map<string, Subscription<any>>()
  #socket: RealtimeSocket | undefined
  #attempt = 0
  #timer: ReturnType<typeof setTimeout> | undefined
  #explicitlyDisconnected = false

  constructor(options: RealtimeOptions) {
    this.#options = {
      url: options.url,
      ...(options.protocols ? { protocols: options.protocols } : {}),
      reconnect: options.reconnect ?? true,
      reconnectMinimumMilliseconds: options.reconnectMinimumMilliseconds ?? 250,
      reconnectMaximumMilliseconds: options.reconnectMaximumMilliseconds ?? 10_000,
    }
    this.#factory = options.socketFactory ?? defaultSocketFactory
  }

  connect(): void {
    if (this.#socket && this.#socket.readyState < 2) return
    this.#explicitlyDisconnected = false
    const socket = this.#factory(this.#options.url, this.#options.protocols)
    this.#socket = socket
    socket.onopen = () => {
      this.#attempt = 0
      for (const subscription of this.#subscriptions.values()) this.#subscribe(subscription)
    }
    socket.onmessage = (event) => this.#receive(event.data)
    socket.onerror = () => undefined
    socket.onclose = () => {
      if (this.#socket === socket) this.#socket = undefined
      if (!this.#explicitlyDisconnected && this.#options.reconnect) this.#scheduleReconnect()
    }
  }

  disconnect(): void {
    this.#explicitlyDisconnected = true
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = undefined
    this.#socket?.close(1000, 'Client disconnect')
    this.#socket = undefined
  }

  channel<Events extends RealtimeEventMap = RealtimeEventMap>(name: string): Subscription<Events> {
    return this.#channel(name, 'public')
  }

  private<Events extends RealtimeEventMap = RealtimeEventMap>(name: string): Subscription<Events> {
    return this.#channel(name, 'private')
  }

  presence<Events extends RealtimeEventMap = RealtimeEventMap>(name: string): Subscription<Events> {
    return this.#channel(name, 'presence')
  }

  leave(name: string, kind?: RealtimeChannelKind): void {
    for (const [key, subscription] of this.#subscriptions) {
      if (subscription.name !== name || (kind && subscription.kind !== kind)) continue
      this.#subscriptions.delete(key)
      this.#send({ protocol: PROTOCOL, type: 'unsubscribe', channel: destination(subscription) })
    }
  }

  #channel<Events extends RealtimeEventMap>(
    name: string,
    kind: RealtimeChannelKind,
  ): Subscription<Events> {
    validateName(name)
    const key = `${kind}:${name}`
    const existing = this.#subscriptions.get(key)
    if (existing) return existing as Subscription<Events>
    const subscription = new Subscription<Events>(this, name, kind)
    this.#subscriptions.set(key, subscription)
    this.connect()
    if (this.#socket?.readyState === 1) this.#subscribe(subscription)
    return subscription
  }

  #subscribe(subscription: Subscription): void {
    this.#send({ protocol: PROTOCOL, type: 'subscribe', channel: destination(subscription) })
  }

  #send(frame: unknown): void {
    if (this.#socket?.readyState === 1) this.#socket.send(JSON.stringify(frame))
  }

  #receive(data: unknown): void {
    let frame: Record<string, unknown>
    try {
      frame = JSON.parse(String(data)) as Record<string, unknown>
    } catch {
      return
    }
    if (frame.protocol !== PROTOCOL || typeof frame.type !== 'string') return
    if (frame.type === 'event' && isEventFrame(frame)) {
      this.#subscriptions.get(channelKey(frame.channel))?.dispatch(frame)
      return
    }
    if (!isChannel(frame.channel)) return
    const subscription = this.#subscriptions.get(channelKey(frame.channel))
    if (!subscription) return
    if (frame.type === 'subscribed') subscription.presence('subscribed', frame.members)
    if (frame.type === 'presence_joined') subscription.presence('presence_joined', frame.member)
    if (frame.type === 'presence_left') subscription.presence('presence_left', frame.member)
  }

  #scheduleReconnect(): void {
    if (this.#timer) return
    const exponential = Math.min(
      this.#options.reconnectMaximumMilliseconds,
      this.#options.reconnectMinimumMilliseconds * 2 ** this.#attempt++,
    )
    const delay = Math.round(exponential * (0.75 + Math.random() * 0.5))
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      this.connect()
    }, delay)
  }
}

function defaultSocketFactory(url: string, protocols?: string | readonly string[]): RealtimeSocket {
  const Constructor = (
    globalThis as unknown as {
      WebSocket?: new (url: string, protocols?: string | readonly string[]) => RealtimeSocket
    }
  ).WebSocket
  if (!Constructor)
    throw new Error('No WebSocket implementation is available; provide socketFactory.')
  return new Constructor(url, protocols)
}

function destination(subscription: Subscription) {
  return { name: subscription.name, kind: subscription.kind }
}

function validateName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(name))
    throw new TypeError('Invalid realtime channel name.')
}

function channelKey(channel: {
  readonly name: string
  readonly kind: RealtimeChannelKind
}): string {
  return `${channel.kind}:${channel.name}`
}

function isChannel(
  value: unknown,
): value is { readonly name: string; readonly kind: RealtimeChannelKind } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    ['public', 'private', 'presence'].includes(String((value as { kind?: unknown }).kind))
  )
}

function isMember(value: unknown): value is RealtimeMember {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string' &&
    ((value as { id?: unknown }).id === undefined ||
      typeof (value as { id?: unknown }).id === 'string')
  )
}

function isEventFrame(
  frame: Record<string, unknown>,
): frame is Record<string, unknown> & RealtimeEventFrame {
  return (
    typeof frame.id === 'string' &&
    typeof frame.event === 'string' &&
    isChannel(frame.channel) &&
    typeof frame.occurredAt === 'string'
  )
}

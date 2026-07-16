import { AsyncLocalStorage } from 'node:async_hooks'

import type { JsonValue } from './index.js'
import { safeDiagnosticError } from './privacy-error.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export interface LogContext {
  readonly executionId?: string
  readonly correlationId?: string
  readonly causationId?: string
  readonly actorKind?: string
  readonly actorId?: string
  readonly tenantId?: string
  readonly traceId?: string
  readonly spanId?: string
  readonly parentSpanId?: string
  readonly transport?: string
}

export interface LogError {
  readonly name: string
  readonly message: string
  readonly stack?: string
  readonly cause?: LogError
}

export interface LogRecord {
  readonly timestamp: string
  readonly level: LogLevel
  readonly channel: string
  readonly message: string
  readonly attributes: Readonly<Record<string, JsonValue>>
  readonly context: LogContext
  readonly error?: LogError
}

export abstract class LogSink {
  abstract write(record: LogRecord): void
  flush?(): void | Promise<void>
}

export class NoopLogSink extends LogSink {
  write(_record: LogRecord): void {}
}

export class MemoryLogSink extends LogSink {
  readonly records: LogRecord[] = []

  write(record: LogRecord): void {
    this.records.push(record)
  }

  clear(): void {
    this.records.length = 0
  }
}

export interface LoggerOptions {
  readonly sink?: LogSink
  readonly level?: LogLevel
  readonly channel?: string
  readonly attributes?: Readonly<Record<string, unknown>>
}

const LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
}

const contextStorage = new AsyncLocalStorage<LogContext>()

/** Framework-provided, structured application logger. */
export class Logger {
  readonly #sink: LogSink
  readonly #level: LogLevel
  readonly #channel: string
  readonly #attributes: Readonly<Record<string, JsonValue>>

  constructor(options: LoggerOptions = {}) {
    this.#sink = options.sink ?? new NoopLogSink()
    this.#level = options.level ?? 'info'
    this.#channel = normalizeChannel(options.channel ?? 'app')
    this.#attributes = safeSanitizeAttributes(options.attributes ?? {})
  }

  channel(channel: string, attributes: Readonly<Record<string, unknown>> = {}): Logger {
    return new Logger({
      sink: this.#sink,
      level: this.#level,
      channel,
      attributes: safeMergeAttributes(this.#attributes, attributes),
    })
  }

  with(attributes: Readonly<Record<string, unknown>>): Logger {
    return this.channel(this.#channel, attributes)
  }

  debug(message: string, attributes?: Readonly<Record<string, unknown>>): void {
    this.write('debug', message, attributes)
  }

  info(message: string, attributes?: Readonly<Record<string, unknown>>): void {
    this.write('info', message, attributes)
  }

  warn(message: string, attributes?: Readonly<Record<string, unknown>>): void {
    this.write('warn', message, attributes)
  }

  error(message: string, attributes?: Readonly<Record<string, unknown>>): void
  error(message: string, error: unknown, attributes?: Readonly<Record<string, unknown>>): void
  error(
    message: string,
    errorOrAttributes?: unknown,
    attributes?: Readonly<Record<string, unknown>>,
  ): void {
    const hasError = attributes !== undefined || errorOrAttributes instanceof Error
    this.write(
      'error',
      message,
      hasError ? attributes : (errorOrAttributes as Readonly<Record<string, unknown>> | undefined),
      hasError ? errorOrAttributes : undefined,
    )
  }

  fatal(message: string, attributes?: Readonly<Record<string, unknown>>): void
  fatal(message: string, error: unknown, attributes?: Readonly<Record<string, unknown>>): void
  fatal(
    message: string,
    errorOrAttributes?: unknown,
    attributes?: Readonly<Record<string, unknown>>,
  ): void {
    const hasError = attributes !== undefined || errorOrAttributes instanceof Error
    this.write(
      'fatal',
      message,
      hasError ? attributes : (errorOrAttributes as Readonly<Record<string, unknown>> | undefined),
      hasError ? errorOrAttributes : undefined,
    )
  }

  async flush(): Promise<void> {
    try {
      await this.#sink.flush?.()
    } catch {
      // Logging must never change application behavior, including shutdown.
    }
  }

  private write(
    level: LogLevel,
    message: string,
    attributes: Readonly<Record<string, unknown>> = {},
    error?: unknown,
  ): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.#level]) return
    try {
      const record: LogRecord = Object.freeze({
        timestamp: new Date().toISOString(),
        level,
        channel: this.#channel,
        message: redactText(message),
        attributes: Object.freeze({ ...this.#attributes, ...sanitizeAttributes(attributes) }),
        context: Object.freeze({ ...(contextStorage.getStore() ?? {}) }),
        ...(error === undefined ? {} : { error: sanitizeError(error) }),
      })
      this.#sink.write(record)
    } catch {
      // Logging must never change application behavior.
    }
  }
}

export type LogFormat = 'pretty' | 'json'

export interface LogDestination {
  write(chunk: string): unknown
  readonly isTTY?: boolean
}

export interface ConsoleLogSinkOptions {
  readonly format?: LogFormat
  readonly color?: boolean
  readonly destination?: LogDestination
}

export class ConsoleLogSink extends LogSink {
  readonly #format: LogFormat
  readonly #color: boolean
  readonly #destination: LogDestination

  constructor(options: ConsoleLogSinkOptions = {}) {
    super()
    this.#destination = options.destination ?? process.stdout
    this.#format = options.format ?? (this.#destination.isTTY ? 'pretty' : 'json')
    this.#color = options.color ?? Boolean(this.#destination.isTTY && this.#format === 'pretty')
  }

  write(record: LogRecord): void {
    this.#destination.write(
      `${this.#format === 'json' ? JSON.stringify(record) : formatPrettyLog(record, this.#color)}\n`,
    )
  }
}

export function runWithLogContext<Output>(context: LogContext, work: () => Output): Output {
  return contextStorage.run(Object.freeze({ ...context }), work)
}

export function formatPrettyLog(record: LogRecord, color = false): string {
  const time = record.timestamp.slice(11, 23)
  const channel = `[${record.channel}]`.padEnd(12)
  const prefix = `${paint(time, 'dim', color)} ${paint(channel, channelColor(record.channel), color)}`
  const message = paint(record.message, levelColor(record.level), color)
  const fields = {
    ...record.attributes,
    ...(record.error && record.context.correlationId
      ? { correlation: record.context.correlationId }
      : {}),
    ...(record.error ? { error: `${record.error.name}: ${record.error.message}` } : {}),
  }
  const rendered = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      const label = /duration(?:Ms|Milliseconds)$/i.test(key) ? 'duration' : key
      return `${paint(label, 'dim', color)}=${renderPrettyField(key, value, color)}`
    })
    .join(' ')
  return `${prefix} ${message}${rendered ? ` ${rendered}` : ''}`
}

function sanitizeAttributes(
  attributes: Readonly<Record<string, unknown>>,
): Readonly<Record<string, JsonValue>> {
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      isSensitiveKey(key) ? '[REDACTED]' : sanitizeValue(value, new WeakSet(), 0),
    ]),
  )
}

function safeSanitizeAttributes(
  attributes: Readonly<Record<string, unknown>>,
): Readonly<Record<string, JsonValue>> {
  try {
    return sanitizeAttributes(attributes)
  } catch {
    return { loggingError: 'attributes_unavailable' }
  }
}

function safeMergeAttributes(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  try {
    return { ...left, ...right }
  } catch {
    return { ...left, loggingError: 'attributes_unavailable' }
  }
}

function sanitizeValue(value: unknown, seen: WeakSet<object>, depth: number): JsonValue {
  if (isSecretValue(value)) return '[REDACTED]'
  if (value === undefined) return '[undefined]'
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function')
    return String(value)
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (depth >= 8) return '[MAX_DEPTH]'
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, seen, depth + 1))
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        isSensitiveKey(key) ? '[REDACTED]' : sanitizeValue(child, seen, depth + 1),
      ]),
    )
  } finally {
    seen.delete(value)
  }
}

function sanitizeError(error: unknown, seen = new Set<unknown>()): LogError {
  error = safeDiagnosticError(error)
  if (!(error instanceof Error)) return { name: 'Error', message: redactText(String(error)) }
  if (seen.has(error)) return { name: error.name, message: '[CIRCULAR CAUSE]' }
  seen.add(error)
  return Object.freeze({
    name: error.name,
    message: redactText(error.message),
    ...(error.stack ? { stack: redactText(error.stack) } : {}),
    ...(error.cause === undefined ? {} : { cause: sanitizeError(error.cause, seen) }),
  })
}

function isSensitiveKey(key: string): boolean {
  const segmented = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  return /(^|[-_.])(password|passphrase|secret|token|authorization|cookie|set-cookie|api[-_]?key|private[-_]?key)([-_.]|$)/i.test(
    segmented,
  )
}

function redactText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis):\/\/([^:\s/@]+):([^@\s/]+)@/gi,
      '$1://$2:[REDACTED]@',
    )
    .replace(/\b(password|passphrase|secret|token|api[-_]?key)=([^\s,;]+)/gi, '$1=[REDACTED]')
}

function isSecretValue(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    value.constructor?.name === 'SecretString' &&
    String(value) === '[REDACTED]'
  )
}

function normalizeChannel(channel: string): string {
  const normalized = channel
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
  return normalized || 'app'
}

function renderPrettyValue(value: JsonValue | undefined): string {
  if (typeof value === 'string') return /\s/.test(value) ? JSON.stringify(value) : value
  return JSON.stringify(value)
}

function renderPrettyField(key: string, value: JsonValue | undefined, color: boolean): string {
  if (typeof value === 'number' && /duration(?:Ms|Milliseconds)$/i.test(key)) {
    const duration = value < 10 ? value.toFixed(1) : Math.round(value).toString()
    return paint(`${duration}ms`, 'cyan', color)
  }
  if (key === 'status' && typeof value === 'number') {
    const statusColor: AnsiColor = value >= 500 ? 'red' : value >= 400 ? 'yellow' : 'green'
    return paint(String(value), statusColor, color)
  }
  return renderPrettyValue(value)
}

type AnsiColor = 'dim' | 'red' | 'yellow' | 'green' | 'blue' | 'magenta' | 'cyan' | 'gray'
const ANSI: Readonly<Record<AnsiColor, number>> = {
  dim: 2,
  red: 31,
  yellow: 33,
  green: 32,
  blue: 34,
  magenta: 35,
  cyan: 36,
  gray: 90,
}

function paint(value: string, color: AnsiColor, enabled: boolean): string {
  return enabled ? `\u001B[${ANSI[color]}m${value}\u001B[0m` : value
}

function levelColor(level: LogLevel): AnsiColor {
  if (level === 'fatal' || level === 'error') return 'red'
  if (level === 'warn') return 'yellow'
  if (level === 'debug') return 'gray'
  return 'green'
}

function channelColor(channel: string): AnsiColor {
  const colors: readonly AnsiColor[] = ['cyan', 'magenta', 'blue', 'yellow', 'green']
  let hash = 0
  for (const character of channel) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
  return colors[Math.abs(hash) % colors.length]!
}

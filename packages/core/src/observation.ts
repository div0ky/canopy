import type { ActorKind, JsonValue } from './index.js'

export type ObservationKind =
  | 'execution'
  | 'http'
  | 'action'
  | 'query'
  | 'transaction'
  | 'model'
  | 'event'
  | 'listener'
  | 'signal'
  | 'job'
  | 'schedule'
  | 'authorization'
  | 'cache'
  | 'mail'
  | 'sms'
  | 'log'
  | 'exception'

export type ObservationPhase = 'started' | 'completed' | 'failed' | 'occurred'

export interface ObservationContext {
  readonly executionId?: string
  readonly sourceExecutionId?: string
  readonly correlationId?: string
  readonly causationId?: string
  readonly traceId?: string
  readonly spanId?: string
  readonly actorKind?: ActorKind
  readonly actorId?: string
  readonly tenantId?: string
  readonly transport?: string
  readonly transportName?: string
}

export interface ObservationError {
  readonly name: string
  readonly message: string
  readonly stack?: string
  readonly cause?: ObservationError
}

export interface Observation {
  readonly id: string
  readonly occurredAt: string
  readonly kind: ObservationKind
  readonly name: string
  readonly phase: ObservationPhase
  readonly roleId?: string
  readonly durationMilliseconds?: number
  readonly context: ObservationContext
  readonly attributes: Readonly<Record<string, JsonValue>>
  readonly error?: ObservationError
}

/** Optional development-observation sink. Implementations must never affect application behavior. */
export abstract class ObservationRecorder {
  abstract record(observation: Observation): void | Promise<void>
}

export class NoopObservationRecorder extends ObservationRecorder {
  record(_observation: Observation): void {}
}

export class MemoryObservationRecorder extends ObservationRecorder {
  readonly observations: Observation[] = []

  record(observation: Observation): void {
    this.observations.push(structuredClone(observation))
  }

  reset(): void {
    this.observations.length = 0
  }
}

export function sanitizeObservationAttributes(
  attributes: Readonly<Record<string, unknown>>,
): Readonly<Record<string, JsonValue>> {
  try {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(attributes).map(([key, value]) => [
          key,
          isSensitiveKey(key) ? '[REDACTED]' : sanitizeValue(value, new WeakSet(), 0),
        ]),
      ),
    )
  } catch {
    return Object.freeze({ observationError: 'attributes_unavailable' })
  }
}

export function sanitizeObservationError(error: unknown): ObservationError {
  if (!(error instanceof Error)) {
    return Object.freeze({ name: 'Error', message: redactText(String(error)) })
  }
  return Object.freeze({
    name: error.name || 'Error',
    message: redactText(error.message),
    ...(error.stack ? { stack: redactText(error.stack) } : {}),
    ...(error.cause === undefined ? {} : { cause: sanitizeObservationError(error.cause) }),
  })
}

function sanitizeValue(value: unknown, seen: WeakSet<object>, depth: number): JsonValue {
  if (depth > 8) return '[TRUNCATED]'
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return redactText(value)
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (isSecretString(value)) return '[REDACTED]'
  if (Array.isArray(value))
    return value.slice(0, 100).map((entry) => sanitizeValue(entry, seen, depth + 1))
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)
  try {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, nested]) => [
          key,
          isSensitiveKey(key) ? '[REDACTED]' : sanitizeValue(nested, seen, depth + 1),
        ]),
    )
  } finally {
    seen.delete(value)
  }
}

function isSensitiveKey(key: string): boolean {
  return /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|credential|session|csrf|signature)/i.test(
    key,
  )
}

function isSecretString(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    value.constructor?.name === 'SecretString' &&
    String(value) === '[REDACTED]'
  )
}

function redactText(value: string): string {
  return value
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s/]+@/gi, '$1[REDACTED]@')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[REDACTED]')
    .replace(/\b(token|password|secret|api[-_]?key|authorization)=([^\s&]+)/gi, '$1=[REDACTED]')
}

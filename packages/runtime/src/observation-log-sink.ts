import { randomUUID } from 'node:crypto'

import {
  sanitizeObservationAttributes,
  type LogRecord,
  type LogSink,
  type Observation,
  type ObservationContext,
  type ObservationRecorder,
} from '@canopy/core'

export class ObservationLogSink {
  #observations: ObservationRecorder | undefined

  constructor(private readonly primary?: LogSink) {}

  attach(observations: ObservationRecorder): void {
    this.#observations = observations
  }

  write(record: LogRecord): void {
    try {
      this.primary?.write(record)
    } catch {
      /* Logging never changes application behavior. */
    }
    const observations = this.#observations
    if (!observations || !record.context.executionId) return
    const observation: Observation = Object.freeze({
      id: randomUUID(),
      occurredAt: record.timestamp,
      kind: 'log',
      name: record.message,
      phase: 'occurred',
      context: Object.freeze({
        executionId: record.context.executionId,
        ...(record.context.correlationId ? { correlationId: record.context.correlationId } : {}),
        ...(record.context.causationId ? { causationId: record.context.causationId } : {}),
        ...(record.context.traceId ? { traceId: record.context.traceId } : {}),
        ...(record.context.spanId ? { spanId: record.context.spanId } : {}),
        ...(record.context.actorKind
          ? { actorKind: record.context.actorKind as NonNullable<ObservationContext['actorKind']> }
          : {}),
        ...(record.context.actorId ? { actorId: record.context.actorId } : {}),
        ...(record.context.tenantId ? { tenantId: record.context.tenantId } : {}),
        ...(record.context.transport ? { transport: record.context.transport } : {}),
      }),
      attributes: sanitizeObservationAttributes({
        channel: record.channel,
        level: record.level,
        ...record.attributes,
      }),
      ...(record.error ? { error: record.error } : {}),
    })
    try {
      const result = observations.record(observation)
      if (result instanceof Promise) void result.catch(() => undefined)
    } catch {
      /* Debugging never changes application behavior. */
    }
  }

  async flush(): Promise<void> {
    try {
      await this.primary?.flush?.()
    } catch {
      /* Logging never changes application behavior. */
    }
  }
}

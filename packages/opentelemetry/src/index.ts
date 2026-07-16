import {
  ROOT_CONTEXT,
  SpanStatusCode,
  TraceFlags,
  metrics,
  trace,
  type Attributes,
  type Counter,
  type Histogram,
  type SpanContext,
} from '@opentelemetry/api'
import {
  Telemetry,
  type JsonValue,
  type TelemetryRecord,
  type TelemetrySpanHandle,
  type TelemetrySpanEnd,
  type TelemetrySpanStart,
} from '@doxajs/core'

export interface DoxaOpenTelemetryOptions {
  readonly instrumentationName?: string
  readonly instrumentationVersion?: string
}

export class DoxaOpenTelemetry extends Telemetry {
  static readonly id = 'telemetry'
  readonly #tracer
  readonly #meter
  readonly #counters = new Map<string, Counter>()
  readonly #histograms = new Map<string, Histogram>()

  constructor(options: DoxaOpenTelemetryOptions = {}) {
    super()
    const name = options.instrumentationName ?? '@doxajs/runtime'
    this.#tracer = trace.getTracer(name, options.instrumentationVersion)
    this.#meter = metrics.getMeter(name, options.instrumentationVersion)
  }

  startSpan(input: TelemetrySpanStart): TelemetrySpanHandle {
    const parentContext = parentSpanContext(input)
    const span = this.#tracer.startSpan(
      input.name,
      {
        startTime: new Date(input.startedAt),
        attributes: attributes(input.attributes),
        ...(input.context.links?.length
          ? {
              links: input.context.links.map((link) => ({
                context: spanContext(link.traceId, link.spanId, input.context.traceFlags),
                ...(link.attributes ? { attributes: attributes(link.attributes) } : {}),
              })),
            }
          : {}),
      },
      parentContext,
    )
    const actual = span.spanContext()
    return Object.freeze({
      context: Object.freeze({
        traceId: actual.traceId,
        spanId: actual.spanId,
        ...(input.context.parentSpanId ? { parentSpanId: input.context.parentSpanId } : {}),
        traceFlags: actual.traceFlags,
        ...(input.context.links?.length ? { links: input.context.links } : {}),
      }),
      end: (result: TelemetrySpanEnd) => {
        span.setAttributes(attributes(result.attributes))
        span.setStatus({
          code: result.status === 'ok' ? SpanStatusCode.OK : SpanStatusCode.ERROR,
        })
        span.end(new Date(result.endedAt))
      },
    })
  }

  record(record: TelemetryRecord): void {
    if (record.kind !== 'metric') return
    const values = attributes(record.attributes)
    if (record.unit === 'milliseconds') {
      const histogram =
        this.#histograms.get(record.name) ??
        this.#meter.createHistogram(record.name, { unit: 'ms' })
      this.#histograms.set(record.name, histogram)
      histogram.record(record.value, values)
      return
    }
    const counter = this.#counters.get(record.name) ?? this.#meter.createCounter(record.name)
    this.#counters.set(record.name, counter)
    counter.add(record.value, values)
  }
}

function parentSpanContext(input: TelemetrySpanStart) {
  const traceId = input.context.traceId
  const parentSpanId = input.context.parentSpanId
  if (!traceId || !parentSpanId) return ROOT_CONTEXT
  return trace.setSpanContext(
    ROOT_CONTEXT,
    spanContext(traceId, parentSpanId, input.context.traceFlags),
  )
}

function spanContext(traceId: string, spanId: string, traceFlags = 1): SpanContext {
  return Object.freeze({
    traceId,
    spanId,
    traceFlags: traceFlags & TraceFlags.SAMPLED ? TraceFlags.SAMPLED : TraceFlags.NONE,
    isRemote: false,
  })
}

function attributes(values: Readonly<Record<string, JsonValue>>): Attributes {
  const converted: Attributes = {}
  for (const [key, value] of Object.entries(values)) {
    if (value === null) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      converted[key] = value
    } else if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
      converted[key] = value as string[]
    } else if (Array.isArray(value) && value.every((entry) => typeof entry === 'number')) {
      converted[key] = value as number[]
    } else if (Array.isArray(value) && value.every((entry) => typeof entry === 'boolean')) {
      converted[key] = value as boolean[]
    } else {
      converted[key] = JSON.stringify(value)
    }
  }
  return converted
}

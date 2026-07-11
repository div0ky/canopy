import type { JsonValue } from './index.js'

export type TelemetryRecord =
  | {
      readonly kind: 'log'
      readonly level: 'debug' | 'info' | 'warn' | 'error'
      readonly event: string
      readonly attributes: Readonly<Record<string, JsonValue>>
    }
  | {
      readonly kind: 'metric'
      readonly name: string
      readonly value: number
      readonly unit: 'count' | 'milliseconds'
      readonly attributes: Readonly<Record<string, JsonValue>>
    }
  | {
      readonly kind: 'span'
      readonly name: string
      readonly traceId: string
      readonly spanId: string
      readonly durationMilliseconds: number
      readonly status: 'ok' | 'error'
      readonly attributes: Readonly<Record<string, JsonValue>>
    }

export abstract class Telemetry {
  abstract record(record: TelemetryRecord): void | Promise<void>
}

export class NoopTelemetry extends Telemetry {
  record(_record: TelemetryRecord): void {}
}

export class MemoryTelemetry extends Telemetry {
  readonly records: TelemetryRecord[] = []
  record(record: TelemetryRecord): void {
    this.records.push(structuredClone(record))
  }
  reset(): void {
    this.records.length = 0
  }
}

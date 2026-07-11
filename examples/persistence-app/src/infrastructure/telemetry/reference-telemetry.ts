import { Telemetry, type TelemetryRecord } from '@doxajs/core'

export const telemetryRecords: TelemetryRecord[] = []
export function resetTelemetryRecords(): void {
  telemetryRecords.length = 0
}

export class ReferenceTelemetry extends Telemetry {
  static id = 'telemetry'
  record(record: TelemetryRecord): void {
    telemetryRecords.push(structuredClone(record))
  }
}

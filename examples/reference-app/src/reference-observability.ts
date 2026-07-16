import {
  ObservationRecorder,
  Telemetry,
  type Observation,
  type TelemetryRecord,
} from '@doxajs/core'

export const referenceObservations: Observation[] = []
export const referenceTelemetry: TelemetryRecord[] = []

export function resetReferenceObservability(): void {
  referenceObservations.length = 0
  referenceTelemetry.length = 0
}

export class ReferenceObservationRecorder extends ObservationRecorder {
  static readonly id = 'reference-observations'

  record(observation: Observation): void {
    referenceObservations.push(structuredClone(observation))
  }
}

export class ReferenceTelemetry extends Telemetry {
  static readonly id = 'reference-telemetry'

  record(record: TelemetryRecord): void {
    referenceTelemetry.push(structuredClone(record))
  }
}

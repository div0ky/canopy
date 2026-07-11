export interface RecordedEvent {
  readonly event: string
  readonly phase: 'local' | 'after-commit' | 'http' | 'queued' | 'signal'
  readonly correlationId: string
  readonly actor: string
  readonly value?: number
  readonly jobId?: string
  readonly attempt?: number
  readonly executionId?: string
}

export const recordedEvents: RecordedEvent[] = []

export function resetRecordedEvents(): void {
  recordedEvents.length = 0
}

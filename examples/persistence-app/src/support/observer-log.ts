export interface ObserverLogEntry {
  readonly phase: string
  readonly modelId: string
  readonly correlationId: string
  readonly value: number
  readonly version?: number
}

export const observerLog: ObserverLogEntry[] = []

export function resetObserverLog(): void {
  observerLog.length = 0
}

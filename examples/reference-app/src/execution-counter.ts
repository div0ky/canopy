import {
  CurrentExecution,
  type Disposes,
  type ExecutionScoped,
  type LifecycleContext,
} from '@doxajs/core'

import { operationLog } from './operation-log.js'

export class ExecutionCounter implements ExecutionScoped, Disposes {
  value = 0

  constructor(private readonly execution: CurrentExecution) {}

  increment(amount: number): number {
    this.execution.assertWritable()
    this.value += amount
    return this.value
  }

  dispose(_context: LifecycleContext): void {
    operationLog.push(`execution-counter:dispose:${this.value}`)
  }
}

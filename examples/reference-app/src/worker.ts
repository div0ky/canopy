import type { LifecycleContext } from '@canopy/core'

import { DatabaseConnection } from './database-connection.js'
import { lifecycleLog } from './lifecycle-log.js'
import { TaskRunner } from './task-runner.js'

export class Worker {
  static id = 'worker'

  constructor(
    readonly database: DatabaseConnection,
    readonly runner: TaskRunner,
  ) {}

  start(_context: LifecycleContext): void {
    lifecycleLog.push(`start:worker:${this.runner.config.concurrency}`)
    if (this.runner.config.failStartup) {
      throw new Error('Reference worker startup failed.')
    }
  }

  drain(_context: LifecycleContext): void {
    lifecycleLog.push('drain:worker')
  }

  stop(_context: LifecycleContext): void {
    lifecycleLog.push('stop:worker')
  }

  dispose(_context: LifecycleContext): void {
    lifecycleLog.push('dispose:worker')
  }
}

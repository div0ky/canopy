import type { LifecycleContext } from '@doxajs/core'

import { AppConfig } from './app-config.js'
import { lifecycleLog } from './lifecycle-log.js'

export class DatabaseConnection {
  static id = 'database-connection'

  constructor(readonly config: AppConfig) {}

  start(_context: LifecycleContext): void {
    lifecycleLog.push(
      `start:database:${this.config.environment}:${this.config.port}:frozen=${Object.isFrozen(this.config)}`,
    )
  }

  drain(_context: LifecycleContext): void {
    lifecycleLog.push('drain:database')
  }

  stop(_context: LifecycleContext): void {
    lifecycleLog.push('stop:database')
  }

  dispose(_context: LifecycleContext): void {
    lifecycleLog.push('dispose:database')
  }
}

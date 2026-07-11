import { PgBossQueueManager } from '@canopy/queue-pg-boss'

import { DatabaseConfig } from '../database/database-config.js'

export class CanopyQueues extends PgBossQueueManager {
  static id = 'queues'

  constructor(config: DatabaseConfig) {
    super({
      connectionString: config.connectionString.reveal(),
      applicationName: 'canopy-persistence-proof',
      localConcurrency: 2,
      outboxPollingMilliseconds: 25,
    })
  }
}

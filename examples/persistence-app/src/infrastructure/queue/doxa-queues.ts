import { PgBossQueueManager } from '@doxajs/queue-pg-boss'

import { DatabaseConfig } from '../database/database-config.js'

export class DoxaQueues extends PgBossQueueManager {
  static id = 'queues'

  constructor(config: DatabaseConfig) {
    super({
      connectionString: config.connectionString.reveal(),
      applicationName: 'doxa-persistence-proof',
      localConcurrency: 2,
      outboxPollingMilliseconds: 25,
    })
  }
}

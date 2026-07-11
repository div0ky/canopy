import { PostgresCache } from '@doxajs/postgres-drizzle'

import { DatabaseConfig } from '../database/database-config.js'

export class DoxaCache extends PostgresCache {
  static id = 'cache'

  constructor(config: DatabaseConfig) {
    super({
      connectionString: config.connectionString.reveal(),
      applicationName: 'doxa-persistence-proof-cache',
    })
  }
}

import { PostgresCache } from '@canopy/postgres-drizzle'

import { DatabaseConfig } from '../database/database-config.js'

export class CanopyCache extends PostgresCache {
  static id = 'cache'

  constructor(config: DatabaseConfig) {
    super({
      connectionString: config.connectionString.reveal(),
      applicationName: 'canopy-persistence-proof-cache',
    })
  }
}

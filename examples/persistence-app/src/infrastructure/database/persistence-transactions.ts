import { PostgresTransactionManager } from '@doxajs/postgres-drizzle'

import { DatabaseConfig } from './database-config.js'

export class PersistenceTransactions extends PostgresTransactionManager {
  static id = 'transactions'

  constructor(config: DatabaseConfig) {
    super({
      connectionString: config.connectionString.reveal(),
      maximumConnections: 8,
      applicationName: 'doxa-persistence-proof',
    })
  }
}

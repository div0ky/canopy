import { PostgresAuth } from '@doxajs/auth-postgres'

import { DatabaseConfig } from '../database/database-config.js'

export class DoxaAuth extends PostgresAuth {
  static override readonly id = 'auth'

  constructor(config: DatabaseConfig) {
    super({
      connectionString: config.connectionString.reveal(),
      secureCookies: false,
      trustedOrigins: [
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
        'http://localhost:3001',
        'http://doxa.test',
      ],
    })
  }
}

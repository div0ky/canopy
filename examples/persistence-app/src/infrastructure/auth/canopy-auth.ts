import { PostgresAuth } from '@canopy/auth-postgres'

import { DatabaseConfig } from '../database/database-config.js'

export class CanopyAuth extends PostgresAuth {
  static override readonly id = 'auth'

  constructor(config: DatabaseConfig) {
    super({
      connectionString: config.connectionString.reveal(),
      secureCookies: false,
      trustedOrigins: [
        'http://127.0.0.1:3000',
        'http://canopy.test',
      ],
    })
  }
}

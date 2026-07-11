import { PostgresTheoria } from '@doxajs/theoria'

import { DatabaseConfig } from '../database/database-config.js'

export class ApplicationTheoria extends PostgresTheoria {
  static override readonly id = 'theoria'

  constructor(config: DatabaseConfig) {
    super({
      connectionString: config.connectionString.reveal(),
      applicationName: 'persistence-reference-app-theoria',
    })
  }
}

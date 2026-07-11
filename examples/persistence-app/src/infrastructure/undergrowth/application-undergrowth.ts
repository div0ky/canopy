import { PostgresUndergrowth } from '@canopy/undergrowth'

import { DatabaseConfig } from '../database/database-config.js'

export class ApplicationUndergrowth extends PostgresUndergrowth {
  static override readonly id = 'undergrowth'

  constructor(config: DatabaseConfig) {
    super({
      connectionString: config.connectionString.reveal(),
      applicationName: 'persistence-reference-app-undergrowth',
    })
  }
}

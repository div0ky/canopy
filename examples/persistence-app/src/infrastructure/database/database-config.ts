import { Configuration, SecretString } from '@canopy/core'

export class DatabaseConfig extends Configuration {
  declare connectionString: SecretString
}

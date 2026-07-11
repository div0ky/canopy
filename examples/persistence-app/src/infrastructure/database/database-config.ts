import { Configuration, SecretString } from '@doxajs/core'

export class DatabaseConfig extends Configuration {
  declare connectionString: SecretString
}

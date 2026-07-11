import { DoxaApplication } from '@doxajs/core'

import { AppConfig } from './app-config.js'
import { OperationsFeature } from './operations-feature.js'

export class Application extends DoxaApplication {
  id = 'reference-app'
  configs = [AppConfig]
  features = [OperationsFeature]
}

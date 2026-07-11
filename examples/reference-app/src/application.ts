import { CanopyApplication } from '@canopy/core'

import { AppConfig } from './app-config.js'
import { OperationsFeature } from './operations-feature.js'

export class Application extends CanopyApplication {
  id = 'reference-app'
  configs = [AppConfig]
  features = [OperationsFeature]
}


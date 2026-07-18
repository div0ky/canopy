import { DoxaApplication } from '@doxajs/core'

import { AppConfig } from './app-config.js'
import { AuthorizationFeature } from './authorization-feature.js'
import { OperationsFeature } from './operations-feature.js'
import { SharedStateFeature } from './shared-state-feature.js'

export class Application extends DoxaApplication {
  id = 'reference-app'
  configs = [AppConfig]
  features = [SharedStateFeature, OperationsFeature, AuthorizationFeature]
}

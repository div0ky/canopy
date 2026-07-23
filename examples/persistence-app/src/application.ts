import { DoxaApplication } from '@doxajs/core'

import { CountersFeature } from './counters/counters.feature.js'
import { AccountsFeature } from './accounts/accounts.feature.js'
import { AuthorizationFeature } from './authorization/authorization.feature.js'
import { InfrastructureFeature } from './infrastructure/infrastructure.feature.js'
import { SystemFeature } from './system/system.feature.js'

export class Application extends DoxaApplication {
  id = 'persistence-reference-app'
  features = [
    InfrastructureFeature,
    AccountsFeature,
    AuthorizationFeature,
    CountersFeature,
    SystemFeature,
  ]
}

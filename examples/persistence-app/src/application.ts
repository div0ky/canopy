import { CanopyApplication } from '@canopy/core'

import { CountersFeature } from './counters/counters.feature.js'
import { AccountsFeature } from './accounts/accounts.feature.js'
import { InfrastructureFeature } from './infrastructure/infrastructure.feature.js'
import { SystemFeature } from './system/system.feature.js'

export class Application extends CanopyApplication {
  id = 'persistence-reference-app'
  features = [InfrastructureFeature, AccountsFeature, CountersFeature, SystemFeature]
}

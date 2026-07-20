import { Feature } from '@doxajs/core'

import { ApplicationAccess } from './application-access.js'
import { ExecutionCounter } from './execution-counter.js'

export class SharedStateFeature extends Feature {
  id = 'shared-state'
  provides = [ApplicationAccess, ExecutionCounter]
}

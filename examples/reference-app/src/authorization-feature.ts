import { Feature } from '@doxajs/core'

import { ApplicationPermissions } from './application-permissions.js'
import { ContactDetails } from './contact-details.js'
import { ContactPolicy } from './contact-policy.js'

export class AuthorizationFeature extends Feature {
  id = 'authorization'
  permissionSources = [ApplicationPermissions]
  policies = [ContactPolicy]
  queries = [ContactDetails]
}

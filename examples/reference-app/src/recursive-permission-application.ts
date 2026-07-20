import {
  Authorization,
  DoxaApplication,
  Feature,
  PermissionSource,
  type PermissionSourceRequest,
  Query,
} from '@doxajs/core'

import { AppConfig } from './app-config.js'
import { OperationsFeature } from './operations-feature.js'
import { SharedStateFeature } from './shared-state-feature.js'

export class RecursivePermissions extends PermissionSource {
  static override readonly id = 'recursive'
  static override readonly abilities = ['contact.read']

  private readonly authorization = this.inject(Authorization)

  async resolve(_request: PermissionSourceRequest): Promise<readonly string[]> {
    await this.authorization.decide('contact.read')
    return ['contact.read']
  }
}

class RecursiveContactDetails extends Query<void, string> {
  static readonly id = 'recursive-contact-details'
  static override readonly access = 'contact.read'

  handle(): string {
    return 'unreachable'
  }
}

class RecursiveAuthorizationFeature extends Feature {
  id = 'recursive-authorization'
  permissionSources = [RecursivePermissions]
  queries = [RecursiveContactDetails]
}

export class Application extends DoxaApplication {
  id = 'recursive-permission-reference'
  configs = [AppConfig]
  features = [SharedStateFeature, OperationsFeature, RecursiveAuthorizationFeature]
}

export { RecursiveContactDetails }

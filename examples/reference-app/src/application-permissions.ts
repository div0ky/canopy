import { PermissionSource, type PermissionSourceRequest } from '@doxajs/core'

import { ApplicationAccess } from './application-access.js'
import { operationLog } from './operation-log.js'

export class ApplicationPermissions extends PermissionSource {
  static override readonly id = 'application'
  static override readonly abilities = ['contact.read', 'contact.update']

  private readonly access = this.inject(ApplicationAccess)

  async resolve(request: PermissionSourceRequest): Promise<readonly string[]> {
    operationLog.push(`permission-source:resolve:${request.context.executionId}`)
    return await this.access.abilitiesFor(request.actor)
  }
}

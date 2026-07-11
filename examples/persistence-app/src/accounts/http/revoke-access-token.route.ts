import { Auth, CurrentExecution, Http, type HttpRequest, Route } from '@canopy/core'

import { requirePasswordSession } from './token-management.js'

export class RevokeAccessTokenRoute extends Route {
  static override readonly id = 'revoke-access-token'
  static override readonly access = 'accounts.tokens.manage'
  readonly method = 'DELETE'
  readonly path = '/auth/tokens/:id'

  constructor(private readonly auth: Auth, private readonly execution: CurrentExecution) { super() }

  async handle(request: HttpRequest): Promise<Response> {
    await this.auth.revokeAccessToken(requirePasswordSession(this.execution), request.param('id'))
    return Http.noContent()
  }
}

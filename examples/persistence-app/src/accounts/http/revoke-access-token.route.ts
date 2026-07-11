import { Auth, CurrentExecution, Http, type HttpRequest, Route } from '@doxajs/core'

import { requirePasswordSession } from './token-management.js'

export class RevokeAccessTokenRoute extends Route {
  static override readonly id = 'revoke-access-token'
  static override readonly access = 'accounts.tokens.manage'
  readonly method = 'DELETE'
  readonly path = '/auth/tokens/:id'

  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)

  async handle(request: HttpRequest): Promise<Response> {
    await this.auth.revokeAccessToken(requirePasswordSession(this.execution), request.param('id'))
    return Http.noContent()
  }
}

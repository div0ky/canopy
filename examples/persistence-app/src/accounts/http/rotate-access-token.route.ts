import { Auth, CurrentExecution, type HttpRequest, Route } from '@canopy/core'

import { publicAccessToken, requirePasswordSession } from './token-management.js'

export class RotateAccessTokenRoute extends Route {
  static override readonly id = 'rotate-access-token'
  static override readonly access = 'accounts.tokens.manage'
  readonly method = 'POST'
  readonly path = '/auth/tokens/:id/rotate'

  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)

  async handle(request: HttpRequest) {
    const grant = await this.auth.rotateAccessToken(
      requirePasswordSession(this.execution),
      request.param('id'),
    )
    return { accessToken: publicAccessToken(grant.accessToken), token: grant.token.reveal() }
  }
}

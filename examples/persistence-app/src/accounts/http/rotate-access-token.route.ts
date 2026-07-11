import { Auth, CurrentExecution, Http, type HttpRequest, Route } from '@canopy/core'

import { publicAccessToken, requirePasswordSession } from './token-management.js'

export class RotateAccessTokenRoute extends Route {
  static override readonly id = 'rotate-access-token'
  static override readonly access = 'accounts.tokens.manage'
  readonly method = 'POST'
  readonly path = '/auth/tokens/:id/rotate'

  constructor(private readonly auth: Auth, private readonly execution: CurrentExecution) { super() }

  async handle(request: HttpRequest): Promise<Response> {
    const grant = await this.auth.rotateAccessToken(
      requirePasswordSession(this.execution),
      request.param('id'),
    )
    return Http.json({ accessToken: publicAccessToken(grant.accessToken), token: grant.token.reveal() })
  }
}

import { Auth, CurrentExecution, Http, type HttpRequest, Route } from '@canopy/core'

import { publicAccessToken, requirePasswordSession } from './token-management.js'

export class ListAccessTokensRoute extends Route {
  static override readonly id = 'list-access-tokens'
  static override readonly access = 'accounts.tokens.manage'
  readonly method = 'GET'
  readonly path = '/auth/tokens'

  constructor(private readonly auth: Auth, private readonly execution: CurrentExecution) { super() }

  async handle(_request: HttpRequest): Promise<Response> {
    const identityId = requirePasswordSession(this.execution)
    return Http.json({
      accessTokens: (await this.auth.listAccessTokens(identityId)).map(publicAccessToken),
    })
  }
}

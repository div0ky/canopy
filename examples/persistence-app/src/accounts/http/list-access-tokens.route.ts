import { Auth, CurrentExecution, type HttpRequest, Route } from '@canopy/core'

import { publicAccessToken, requirePasswordSession } from './token-management.js'

export class ListAccessTokensRoute extends Route {
  static override readonly id = 'list-access-tokens'
  static override readonly access = 'accounts.tokens.manage'
  readonly method = 'GET'
  readonly path = '/auth/tokens'

  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)

  async handle(_request: HttpRequest) {
    const identityId = requirePasswordSession(this.execution)
    return {
      accessTokens: (await this.auth.listAccessTokens(identityId)).map(publicAccessToken),
    }
  }
}

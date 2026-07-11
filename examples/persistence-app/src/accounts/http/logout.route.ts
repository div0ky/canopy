import {
  Auth,
  CurrentExecution,
  Http,
  HttpError,
  type HttpRequest,
  Route,
} from '@canopy/core'

export class LogoutRoute extends Route {
  static override readonly id = 'logout'
  static override readonly access = 'accounts.logout'
  readonly method = 'POST'
  readonly path = '/auth/logout'

  constructor(
    private readonly auth: Auth,
    private readonly execution: CurrentExecution,
  ) {
    super()
  }

  async handle(_request: HttpRequest): Promise<Response> {
    const sessionId = this.execution.context.authentication.sessionId
    if (!sessionId) throw new HttpError(401, 'authentication_required', 'Authentication is required.')
    await this.auth.revokeSession(sessionId)
    return Http.noContent({ 'set-cookie': this.auth.expiredSessionCookie() })
  }
}

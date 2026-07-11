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

  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)

  async handle(_request: HttpRequest): Promise<Response> {
    const sessionId = this.execution.context.authentication.sessionId
    if (!sessionId) throw new HttpError(401, 'authentication_required', 'Authentication is required.')
    await this.auth.revokeSession(sessionId)
    return Http.noContent({ 'set-cookie': this.auth.expiredSessionCookie() })
  }
}

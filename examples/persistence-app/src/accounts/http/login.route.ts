import { Auth, CurrentExecution, Http, type HttpRequest, Route } from '@doxajs/core'

import { UserLoggedIn } from '../events/user-logged-in.js'
import { credentials } from './credentials.js'

export class LoginRoute extends Route {
  static override readonly id = 'login'
  static override readonly access = 'public'
  readonly method = 'POST'
  readonly path = '/auth/login'

  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)

  async handle(request: HttpRequest): Promise<Response> {
    const userAgent = request.header('user-agent')
    const grant = await this.auth.login(await credentials(request), {
      ...(userAgent ? { userAgent } : {}),
    })
    const previousSessionId = this.execution.context.authentication.sessionId
    if (previousSessionId) await this.auth.revokeSession(previousSessionId)
    await UserLoggedIn.dispatch({ identityId: grant.identity.id, sessionId: grant.session.id })
    return Http.json(
      {
        identity: {
          id: grant.identity.id,
          email: grant.identity.email,
          emailVerified: grant.identity.emailVerified,
        },
      },
      200,
      { 'set-cookie': this.auth.sessionCookie(grant) },
    )
  }
}

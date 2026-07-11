import {
  Auth,
  CurrentExecution,
  Http,
  type HttpRequest,
  Route,
} from '@canopy/core'

import { UserLoggedIn } from '../events/user-logged-in.js'
import { credentials } from './credentials.js'

export class LoginRoute extends Route {
  static override readonly id = 'login'
  static override readonly access = 'public'
  readonly method = 'POST'
  readonly path = '/auth/login'

  constructor(
    private readonly auth: Auth,
    private readonly execution: CurrentExecution,
  ) {
    super()
  }

  async handle(request: HttpRequest): Promise<Response> {
    const userAgent = request.header('user-agent')
    const grant = await this.auth.login(await credentials(request), {
      ...(userAgent ? { userAgent } : {}),
    })
    const previousSessionId = this.execution.context.authentication.sessionId
    if (previousSessionId) await this.auth.revokeSession(previousSessionId)
    await UserLoggedIn.dispatch(grant.identity.id, grant.session.id)
    return Http.json({
      identity: {
        id: grant.identity.id,
        email: grant.identity.email,
        emailVerified: grant.identity.emailVerified,
      },
    }, 200, { 'set-cookie': this.auth.sessionCookie(grant) })
  }
}

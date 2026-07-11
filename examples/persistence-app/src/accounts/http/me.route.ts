import {
  Auth,
  CurrentExecution,
  Http,
  HttpError,
  type HttpRequest,
  Route,
} from '@canopy/core'

export class MeRoute extends Route {
  static override readonly id = 'me'
  static override readonly access = 'accounts.view-self'
  readonly method = 'GET'
  readonly path = '/auth/me'

  constructor(
    private readonly auth: Auth,
    private readonly execution: CurrentExecution,
  ) {
    super()
  }

  async handle(_request: HttpRequest): Promise<Response> {
    const identityId = this.execution.context.authentication.identityId
    if (!identityId) throw new HttpError(401, 'authentication_required', 'Authentication is required.')
    const identity = await this.auth.findIdentity(identityId)
    if (!identity) throw new HttpError(401, 'authentication_required', 'Authentication is required.')
    return Http.json({
      identity: {
        id: identity.id,
        email: identity.email,
        emailVerified: identity.emailVerified,
      },
      actor: this.execution.context.actor,
      authentication: {
        method: this.execution.context.authentication.method,
        assurance: this.execution.context.authentication.assurance,
        sessionId: this.execution.context.authentication.sessionId,
        credentialId: this.execution.context.authentication.credentialId,
        constraints: this.execution.context.authentication.constraints,
      },
    })
  }
}

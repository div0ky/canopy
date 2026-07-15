import { ActionBus, Auth, Http, type HttpRequest, Route } from '@doxajs/core'

import { SendAuthEmail } from '../actions/send-auth-email.js'

export class RequestPasswordResetRoute extends Route {
  static override readonly id = 'request-password-reset'
  static override readonly access = 'public'
  readonly method = 'POST'
  readonly path = '/auth/password/forgot'
  private readonly auth = this.inject(Auth)
  private readonly actions = this.inject(ActionBus)
  async handle(request: HttpRequest): Promise<Response> {
    const body = await request.json<{ identifier?: unknown }>()
    const identifier = typeof body.identifier === 'string' ? body.identifier : ''
    const grant = await this.auth.issuePasswordReset(identifier)
    if (grant) {
      const identity = await this.auth.findIdentity(grant.identityId)
      if (identity?.contactEmail)
        await this.actions.execute(SendAuthEmail, {
          kind: 'password-reset',
          to: identity.contactEmail,
          token: grant.token.reveal(),
        })
    }
    return Http.accepted(null)
  }
}

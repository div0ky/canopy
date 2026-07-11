import { ActionBus, Auth, Http, type HttpRequest, Route } from '@canopy/core'

import { SendAuthEmail } from '../actions/send-auth-email.js'

export class RequestPasswordResetRoute extends Route {
  static override readonly id = 'request-password-reset'; static override readonly access = 'public'
  readonly method = 'POST'; readonly path = '/auth/password/forgot'
  private readonly auth = this.inject(Auth)
  private readonly actions = this.inject(ActionBus)
  async handle(request: HttpRequest): Promise<Response> {
    const body = await request.json<{ email?: unknown }>()
    const email = typeof body.email === 'string' ? body.email : ''
    const grant = await this.auth.issuePasswordReset(email)
    if (grant) {
      const identity = await this.auth.findIdentity(grant.identityId)
      if (identity) await this.actions.execute(SendAuthEmail, { kind: 'password-reset', to: identity.email, token: grant.token.reveal() })
    }
    return Http.accepted(null)
  }
}

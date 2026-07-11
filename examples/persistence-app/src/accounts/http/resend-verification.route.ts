import { ActionBus, Auth, CurrentExecution, type HttpRequest, Route } from '@canopy/core'

import { SendAuthEmail } from '../actions/send-auth-email.js'

export class ResendVerificationRoute extends Route {
  static override readonly id = 'resend-verification'; static override readonly access = 'accounts.email.verify'
  readonly method = 'POST'; readonly path = '/auth/email/verification'
  constructor(private readonly auth: Auth, private readonly actions: ActionBus, private readonly execution: CurrentExecution) { super() }
  async handle(_request: HttpRequest): Promise<Response> {
    const identity = await this.auth.findIdentity(this.execution.context.authentication.identityId!)
    if (identity && !identity.emailVerified) {
      const grant = await this.auth.issueEmailVerification(identity.id)
      await this.actions.execute(SendAuthEmail, { kind: 'verification', to: identity.email, token: grant.token.reveal() })
    }
    return new Response(null, { status: 202 })
  }
}

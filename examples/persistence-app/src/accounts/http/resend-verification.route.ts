import { ActionBus, Auth, CurrentExecution, Http, type HttpRequest, Route } from '@doxajs/core'

import { SendAuthEmail } from '../actions/send-auth-email.js'

export class ResendVerificationRoute extends Route {
  static override readonly id = 'resend-verification'
  static override readonly access = 'accounts.email.verify'
  readonly method = 'POST'
  readonly path = '/auth/email/verification'
  private readonly auth = this.inject(Auth)
  private readonly actions = this.inject(ActionBus)
  private readonly execution = this.inject(CurrentExecution)
  async handle(_request: HttpRequest): Promise<Response> {
    const identity = await this.auth.findIdentity(this.execution.context.authentication.identityId!)
    if (identity?.contactEmail && identity.verification === 'unverified') {
      const grant = await this.auth.issueEmailVerification(identity.id)
      await this.actions.execute(SendAuthEmail, {
        kind: 'verification',
        to: identity.contactEmail,
        token: grant.token.reveal(),
      })
    }
    return Http.accepted(null)
  }
}
